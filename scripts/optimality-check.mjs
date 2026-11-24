// UniHaat — is the Huffman tree actually optimal?
//
// The engine's own suite checks that files come back byte for byte.
// This checks a different thing: that the tree it builds is the
// cheapest one it could have built.
//
// The cost of a tree is the number of bits the file becomes — the
// frequency of each symbol times the length of its code. The greedy
// algorithm is supposed to give the minimum possible cost, and this
// works the cost out a second time, with a different implementation,
// and compares the two.
//
// It also checks the two properties the codes have to have for the
// bit stream to be readable back: no code may be the beginning of
// another, and the sum of one-over-two-to-the-code-length cannot go
// above one.
//
//   node scripts/optimality-check.mjs
//
// The script exits non-zero if anything is wrong.

import { compress, byteFrequencies, buildHuffmanTree, generateCodes } from "../src/huffman.js";

const enc = new TextEncoder();

let failures = 0;

/**
 * The cost of the best tree for these counts, worked out independently.
 *
 * The engine uses a heap; this uses a sorted list. Two different
 * implementations of the same greedy step, so an agreement between
 * them means something.
 */
function optimalCost(counts) {
  const syms = [];
  for (let s = 0; s < 256; s += 1) if (counts[s] > 0) syms.push({ w: counts[s], s });
  if (syms.length === 1) return counts[syms[0].s];

  const order = syms.slice().sort((a, b) => a.w - b.w || a.s - b.s);
  const heap = order.map((x, i) => ({ w: x.w, node: { leaf: x.s, left: null, right: null }, seq: i }));
  let seq = heap.length;

  while (heap.length > 1) {
    heap.sort((a, b) => a.w - b.w || a.seq - b.seq);
    const a = heap.shift();
    const b = heap.shift();
    heap.push({ w: a.w + b.w, node: { leaf: -1, left: a.node, right: b.node }, seq: seq++ });
  }

  const walk = (node, depth) => {
    if (node.leaf >= 0) return counts[node.leaf] * depth;
    return walk(node.left, depth + 1) + walk(node.right, depth + 1);
  };
  return walk(heap[0].node, 0);
}

/** The Kraft sum of a set of codes. */
function kraftSum(codes) {
  let s = 0;
  for (const c of codes.values()) s += 2 ** -c.length;
  return s;
}

/** No code may be the beginning of another. */
function isPrefixFree(codes) {
  const list = [...codes.values()];
  for (const a of list) {
    for (const b of list) {
      if (a !== b && b.startsWith(a)) return false;
    }
  }
  return true;
}

const cases = {
  "abracadabra": "abracadabra",
  "english text": "The quick brown fox jumps over the lazy dog. ".repeat(40),
  aabbbc: "aabbbc",
  mississippi: "mississippi",
  "single symbol": "aaaaa",
};

console.log("case              | mine | optimal | equal | kraft<=1 | prefix-free | payload");
console.log("------------------+------+---------+-------+----------+------------+--------");

for (const [name, text] of Object.entries(cases)) {
  const bytes = enc.encode(text);
  const counts = byteFrequencies(bytes);
  const { root } = buildHuffmanTree(counts);
  const codes = generateCodes(root);

  // The engine's tree, measured.
  let mine = 0;
  for (let s = 0; s < 256; s += 1) {
    if (counts[s] > 0) mine += counts[s] * codes.get(s).length;
  }

  const opt = optimalCost(counts);
  const kraft = kraftSum(codes);
  const prefixFree = isPrefixFree(codes);

  // The payload has to be exactly as many bytes as the cost says.
  const packed = compress(bytes);
  const payloadBytes = packed.container.length - 14 - packed.treeBytes;
  const expectedBytes = Math.ceil(mine / 8);
  const payloadOk = payloadBytes === expectedBytes;

  console.log(
    `${name.padEnd(17)} | ${String(mine).padStart(4)} | ${String(opt).padStart(7)} | ` +
      `${String(mine === opt).padStart(5)} | ${String(kraft <= 1.0000001).padStart(8)} | ` +
      `${String(prefixFree).padEnd(10)} | ${payloadBytes}/${expectedBytes}` +
      `${payloadOk ? "" : "  <- wrong"}`
  );

  if (mine !== opt) {
    console.log(`   !! the tree costs ${mine} bits, the best possible is ${opt}`);
    failures += 1;
  }
  if (kraft > 1.0000001) {
    console.log(`   !! the Kraft sum is ${kraft}, so the codes cannot all be told apart`);
    failures += 1;
  }
  if (!prefixFree) {
    console.log("   !! one code is the beginning of another");
    failures += 1;
  }
  if (!payloadOk) {
    console.log(`   !! the payload is ${payloadBytes} bytes, it should be ${expectedBytes}`);
    failures += 1;
  }
}

/* The large-alphabet case, which is where a tie-break can go wrong. */

console.log("\na large alphabet, unevenly used");
{
  const bytes = new Uint8Array(64 * 1024);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = i % 4 === 0 ? 16 + Math.floor(i / 4) % 240 : i % 16;
  }
  const counts = byteFrequencies(bytes);
  const { root } = buildHuffmanTree(counts);
  const codes = generateCodes(root);

  let mine = 0;
  for (let s = 0; s < 256; s += 1) {
    if (counts[s] > 0) mine += counts[s] * codes.get(s).length;
  }
  const opt = optimalCost(counts);

  console.log(`  ${codes.size} distinct values, ${mine} bits against an optimum of ${opt}`);
  if (mine !== opt) {
    console.log("   !! the tree is not the cheapest one");
    failures += 1;
  }
  if (!isPrefixFree(codes)) {
    console.log("   !! one code is the beginning of another");
    failures += 1;
  }
  if (kraftSum(codes) > 1.0000001) {
    console.log("   !! the Kraft sum is above one");
    failures += 1;
  }
}

if (failures) {
  console.log(`\n✗ ${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\n✓ the trees are optimal and the codes are well formed.");
