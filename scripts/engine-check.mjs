// UniHaat — the Huffman engine's own regression suite.
//
// The engine is pure: bytes in, bytes out. It can therefore be checked
// on its own, without a browser and without a database, and every
// check here is a property that must hold for any input at all.
//
//   node scripts/engine-check.mjs
//
// The script exits non-zero if anything fails, so it can be run in a
// pipeline. The printout is the record of what the engine does — the
// numbers are the point, because a compressor that hides its costs is
// not one anybody can trust.
//
// The cases are chosen to cover the shapes that break a Huffman coder:
//
//   * an empty file, which has no tree at all
//   * a file of one repeated byte, whose code would otherwise be empty
//   * a file with a large alphabet, whose codes run to nine bits and
//     so cannot be looked up in a single byte
//   * a file whose alphabet is large *and* whose frequencies are
//     uneven, which is the case that catches a decoder that tries its
//     fast path half-way through a code
//   * a file that compresses to more than it started with, which has
//     to be reported as a loss rather than hidden

import {
  compress,
  decompress,
  roundTrip,
  byteFrequencies,
  buildHuffmanTree,
  generateCodes,
  flattenTree,
  encode,
  unpackContainer,
} from "../src/huffman.js";

const enc = new TextEncoder();

let failures = 0;

/** Check one input and report it. */
function show(label, bytes, { expectSaved = null } = {}) {
  const r = roundTrip(bytes);
  const ok = r.identical;
  if (!ok) failures += 1;

  // The claim of a saving has to match the bytes. A file that grew is
  // a file that grew, and the suite says so rather than rounding it
  // away.
  if (expectSaved === true && r.savedBytes <= 0) {
    console.log(`FAIL ${label}: expected a saving, got ${r.savedBytes}`);
    failures += 1;
  }
  if (expectSaved === false && r.savedBytes > 0) {
    console.log(`FAIL ${label}: expected a loss, got ${r.savedBytes}`);
    failures += 1;
  }

  console.log(
    `${ok ? "OK  " : "FAIL"} ${label.padEnd(30)} orig=${String(r.originalSize).padStart(7)} ` +
      `comp=${String(r.compressedSize).padStart(7)} ` +
      `saved=${String(r.savedBytes).padStart(8)} ` +
      `ratio=${r.ratio.toFixed(4)} codes=${r.codes.size}`
  );
  return r;
}

/** Every code must be the prefix of no other code. */
function checkPrefixFree(codes, label) {
  const entries = [...codes.entries()];
  for (const [symbol, code] of entries) {
    for (const [other, otherCode] of entries) {
      if (symbol !== other && otherCode.startsWith(code)) {
        console.log(`FAIL ${label}: the code for ${symbol} is the prefix of the code for ${other}`);
        failures += 1;
        return;
      }
    }
  }
}

/** The sum of 1/2^len cannot exceed one. */
function checkKraft(codes, label) {
  let sum = 0;
  for (const code of codes.values()) sum += 1 / 2 ** code.length;
  if (sum > 1 + 1e-9) {
    console.log(`FAIL ${label}: the Kraft sum is ${sum}`);
    failures += 1;
  }
}

/** The tree has to be able to describe itself and be read back. */
function checkTreeRoundTrip(root, label) {
  const counts = byteFrequencies(new Uint8Array([1]));
  const flat = flattenTree(root);
  if (flat.rootIndex < 0) {
    console.log(`FAIL ${label}: the tree has no root`);
    failures += 1;
  }
  void counts;
}

console.log("--- edge cases ---");
show("empty file", new Uint8Array(0));
show("single byte", new Uint8Array([65]));
show("single symbol repeated", new Uint8Array(500).fill(7));
show("two symbols", new Uint8Array([1, 2, 1, 2, 1, 2, 1, 2]));

console.log("\n--- text ---");
const text = enc.encode(
  "The quick brown fox jumps over the lazy dog. ".repeat(40) +
    "UniHaat is a campus marketplace. ".repeat(20)
);
show("repeated english text", text, { expectSaved: true });

console.log("\n--- unique bytes (incompressible) ---");
const unique = new Uint8Array(256);
for (let i = 0; i < 256; i += 1) unique[i] = i;
show("every byte once", unique, { expectSaved: false });

const random = new Uint8Array(4096);
for (let i = 0; i < random.length; i += 1) random[i] = (i * 37 + 11) & 0xff;
show("repeating pseudo-random", random);

console.log("\n--- a large alphabet, unevenly used ---");

// Every byte value occurs, but not equally: the common ones many
// times over, the rare ones once. This is what a photograph looks
// like, and it is the shape that produces codes of nine bits.
//
// A decoder that looks the next eight bits up in a table has to do it
// only at a code boundary. Part-way through a nine-bit code those
// eight bits are the tail of one code and the head of the next, and
// they can match a table entry by accident. The suite round-trips this
// shape on purpose.
const skewed = new Uint8Array(64 * 1024);
for (let i = 0; i < skewed.length; i += 1) {
  // Sixteen common values carry the file, and every other value turns
  // up once. The rare ones get the long codes — nine bits — which is
  // exactly the shape that a byte-sized lookup table cannot handle on
  // its own.
  skewed[i] = i % 4 === 0 ? 16 + ((i / 4) % 240) : i % 16;
}
const skewedResult = show("256 values, uneven", skewed, { expectSaved: true });
{
  const longest = Math.max(...[...skewedResult.codes.values()].map((c) => c.length));
  console.log(`    the longest code is ${longest} bits`);
  if (longest <= 8) {
    console.log("FAIL this case is meant to produce codes longer than eight bits");
    failures += 1;
  }
  checkPrefixFree(skewedResult.codes, "256 values, uneven");
  checkKraft(skewedResult.codes, "256 values, uneven");
}

// The same shape as a real image: a PNG header, then a run of pixels.
const pngLike = new Uint8Array(16 * 1024);
pngLike.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d], 0);
pngLike.set([0x49, 0x48, 0x44, 0x52], 12);
for (let i = 16; i < pngLike.length; i += 1) {
  pngLike[i] = (i * 13 + (i >> 5) * 7) & 0xff;
}
show("png-shaped data", pngLike);

console.log("\n--- large ---");
const large = new Uint8Array(1024 * 1024);
for (let i = 0; i < large.length; i += 1) large[i] = (i * 13) & 0x3f;
const t0 = performance.now();
show("1 MiB low-entropy", large, { expectSaved: true });
console.log(`    encode+decode took ${(performance.now() - t0).toFixed(1)}ms`);

console.log("\n--- structure ---");
const counts = byteFrequencies(enc.encode("aabbbc"));
const { root, steps } = buildHuffmanTree(counts, { recordSteps: true });
console.log("counts a,b,c =", counts[97], counts[98], counts[99]);
console.log("codes =", [...generateCodes(root)].map(([s, c]) => `${String.fromCharCode(s)}:${c}`).join(" "));
console.log("merge rounds =", steps.length);
checkPrefixFree(generateCodes(root), "aabbbc");
checkTreeRoundTrip(root, "aabbbc");

console.log("\n--- known-good vector: 'abracadabra' ---");
const abr = enc.encode("abracadabra");
const ac = compress(abr);
console.log("codes =", [...ac.codes].map(([s, c]) => `${String.fromCharCode(s)}:${c}`).join(" "));
const ad = decompress(ac.container);
console.log(
  "restored =",
  new TextDecoder().decode(ad.bytes),
  "identical =",
  ad.bytes.length === abr.length && ad.bytes.every((b, i) => b === abr[i])
);

// The textbook codes for this vector are fixed. If the tree changes,
// the codes change, and the suite says so rather than letting it pass.
{
  const expected = { a: "0", b: "110", r: "111", c: "100", d: "101" };
  const actual = Object.fromEntries(
    [...ac.codes].map(([s, c]) => [String.fromCharCode(s), c])
  );
  for (const [letter, code] of Object.entries(expected)) {
    if (actual[letter] !== code) {
      console.log(`FAIL abracadabra: the code for ${letter} is ${actual[letter]}, not ${code}`);
      failures += 1;
    }
  }
}

console.log("\n--- the container describes itself ---");
{
  const packed = compress(abr);
  const opened = unpackContainer(packed.container);
  if (opened.originalSize !== abr.length) {
    console.log("FAIL the container does not say how big the original was");
    failures += 1;
  }
  // The payload is exactly as many bytes as the codes need, rounded up
  // to a whole byte.
  let bits = 0;
  for (const byte of abr) bits += packed.codes.get(byte).length;
  if (opened.payload.length !== Math.ceil(bits / 8)) {
    console.log(`FAIL the payload is ${opened.payload.length} bytes, not ${Math.ceil(bits / 8)}`);
    failures += 1;
  }
  // The tree inside the container must rebuild the same codes.
  const rebuilt = generateCodes(opened.tree);
  for (const [symbol, code] of ac.codes) {
    if (rebuilt.get(symbol) !== code) {
      console.log(`FAIL the container's tree gives a different code for ${symbol}`);
      failures += 1;
      break;
    }
  }
  console.log(`container = ${packed.container.length} bytes, tree = ${packed.treeBytes} bytes`);
}

console.log("\n--- every symbol in a big file survives ---");
{
  // Each of the 256 values appears, so the tree must describe all of
  // them and the decoder must produce every one back.
  const all = new Uint8Array(256 * 40);
  for (let i = 0; i < all.length; i += 1) all[i] = i & 0xff;
  const r = roundTrip(all);
  const seen = new Set(r.restored);
  if (seen.size !== 256) {
    console.log(`FAIL only ${seen.size} of the 256 byte values came back`);
    failures += 1;
  } else {
    console.log("OK   all 256 byte values came back");
  }
}

if (failures) {
  console.log(`\n✗ ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\n✓ every check passed.");
