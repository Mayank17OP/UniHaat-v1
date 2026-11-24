// UniCompress — the Huffman coding engine.
//
// The engine is pure: bytes in, bytes out. It touches no DOM, no network
// and no database, so it can be tested on its own and reused anywhere.
//
// The algorithm is the greedy one from DAA — Huffman coding:
//
//   1. count how often each byte value occurs            O(N)
//   2. put the values in a min-priority queue by count
//   3. take the two smallest, join them under a parent,   O(K log K)
//      put the parent back — repeat until one node is left
//   4. walk the tree; every left turn is a 0, every       O(K)
//      right turn is a 1
//   5. rewrite the input as that bit stream               O(N)
//   6. walk the tree again, one bit at a time, to read    O(N)
//      the original bytes back out
//
// K is the number of distinct byte values, at most 256. N is the number
// of input bytes.
//
// Two edge cases the textbook skips, and a real file hits:
//
//   * An empty file has no symbols at all, so it has no tree. It still
//     has to round-trip.
//
//   * A file of one repeated byte has one symbol, and the greedy
//     algorithm would give it a code of zero length — which encodes
//     nothing and cannot be decoded. Such a symbol is given a one-bit
//     code instead, so the file still round-trips.
//
// The tree travels with the data. `packContainer` writes the tree and
// the bit stream into one self-describing block, so a stored file can
// always be read back without consulting anything else.

/** Every byte value is in the alphabet. */
export const ALPHABET = 256;

/* ------------------------------------------------------------------ queue */

/**
 * A min-priority queue — a binary heap.
 *
 * The queue is what makes the greedy step cheap: taking the two
 * smallest is O(log K) instead of the O(K) a sorted list would cost,
 * so building the whole tree is O(K log K).
 */
export class MinHeap {
  /** @param {(a: any, b: any) => number} compare — negative when a sorts first */
  constructor(compare) {
    this.compare = compare;
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(item) {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(items[i], items[parent]) < 0) {
        const swap = items[i];
        items[i] = items[parent];
        items[parent] = swap;
        i = parent;
      } else break;
    }
  }

  pop() {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && this.compare(items[left], items[smallest]) < 0) {
          smallest = left;
        }
        if (right < items.length && this.compare(items[right], items[smallest]) < 0) {
          smallest = right;
        }
        if (smallest === i) break;
        const swap = items[i];
        items[i] = items[smallest];
        items[smallest] = swap;
        i = smallest;
      }
    }
    return top;
  }
}

/* ------------------------------------------------------------ frequencies */

/**
 * How many times each byte value occurs.
 *
 * O(N) — one pass, one array.
 *
 * @param {Uint8Array} bytes
 * @returns {Uint32Array} counts, indexed by byte value
 */
export function byteFrequencies(bytes) {
  const counts = new Uint32Array(ALPHABET);
  for (let i = 0; i < bytes.length; i += 1) counts[bytes[i]] += 1;
  return counts;
}

/* ------------------------------------------------------------------ tree */

/**
 * Build the Huffman tree from a frequency table.
 *
 * The greedy step: the queue holds the symbols, and each round takes the
 * two least frequent and joins them under a new parent whose count is
 * their sum.
 *
 * @param {Uint32Array} counts
 * @param {{ recordSteps?: boolean }} [options] — record the rounds, so the
 *        interface can show the queue as it empties
 * @returns {{ root: object|null, steps: object[], heap: MinHeap }}
 */
export function buildHuffmanTree(counts, { recordSteps = false } = {}) {
  const heap = new MinHeap((a, b) => a.freq - b.freq || a.serial - b.serial);
  const steps = [];

  // Every symbol that occurs goes into the queue. The serial number
  // breaks ties the same way every time, so the same input always gives
  // the same tree.
  for (let symbol = 0; symbol < ALPHABET; symbol += 1) {
    if (counts[symbol] > 0) {
      heap.push({ freq: counts[symbol], symbol, left: null, right: null, serial: symbol });
    }
  }

  let serial = ALPHABET;
  while (heap.size > 1) {
    const first = heap.pop();
    const second = heap.pop();
    const parent = {
      freq: first.freq + second.freq,
      symbol: -1,
      left: first,
      right: second,
      serial: serial++,
    };
    if (recordSteps) {
      steps.push({
        merged: [first, second],
        parent: { freq: parent.freq, serial: parent.serial },
        queueSize: heap.size + 1,
      });
    }
    heap.push(parent);
  }

  const root = heap.pop() ?? null;
  return { root, steps, heap };
}

/**
 * The binary code for every symbol, from the tree.
 *
 * O(K) — one walk of the tree.
 *
 * @param {object|null} root
 * @returns {Map<number, string>}
 */
export function generateCodes(root) {
  const codes = new Map();
  if (!root) return codes;
  const stack = [[root, ""]];
  while (stack.length > 0) {
    const [node, prefix] = stack.pop();
    if (node.symbol >= 0) {
      // A tree of one symbol would give a zero-length code, which
      // encodes nothing at all. One bit is the shortest code that can
      // still be decoded.
      codes.set(node.symbol, prefix || "0");
      continue;
    }
    stack.push([node.left, `${prefix}0`]);
    stack.push([node.right, `${prefix}1`]);
  }
  return codes;
}

/**
 * The tree flattened into typed arrays.
 *
 * The object tree is fine for showing and for building, but decoding
 * walks it once per bit, and array indexing is much cheaper than
 * chasing pointers.
 */
export function flattenTree(root) {
  if (!root) {
    return {
      left: new Int32Array(0),
      right: new Int32Array(0),
      symbol: new Int16Array(0),
      rootIndex: -1,
    };
  }
  const nodes = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    nodes.push(node);
    if (node.symbol < 0) {
      stack.push(node.left);
      stack.push(node.right);
    }
  }
  const size = nodes.length;
  const left = new Int32Array(size);
  const right = new Int32Array(size);
  const symbol = new Int16Array(size);
  const indexOf = new Map();
  nodes.forEach((node, i) => {
    symbol[i] = node.symbol;
    indexOf.set(node, i);
  });
  nodes.forEach((node, i) => {
    if (node.symbol < 0) {
      left[i] = indexOf.get(node.left);
      right[i] = indexOf.get(node.right);
    }
  });
  return { left, right, symbol, rootIndex: indexOf.get(root) };
}

/* ---------------------------------------------------------------- encode */

/**
 * Rewrite the input as a bit stream.
 *
 * O(N) — each byte contributes its code once. The bits are packed
 * most-significant-first into bytes, so the stream is exactly
 * `ceil(totalBits / 8)` bytes long.
 *
 * @param {Uint8Array} bytes
 * @param {Map<number, string>} codes
 * @returns {Uint8Array}
 */
export function encode(bytes, codes) {
  const lengths = new Uint8Array(ALPHABET);
  for (const [symbol, code] of codes) lengths[symbol] = code.length;

  let totalBits = 0;
  for (let i = 0; i < bytes.length; i += 1) totalBits += lengths[bytes[i]];

  const out = new Uint8Array((totalBits + 7) >> 3);
  let accumulator = 0;
  let held = 0;
  let pos = 0;

  for (let i = 0; i < bytes.length; i += 1) {
    const code = codes.get(bytes[i]);
    if (code === undefined) {
      throw new Error(`no code for byte ${bytes[i]}`);
    }
    for (let c = 0; c < code.length; c += 1) {
      accumulator = (accumulator << 1) | (code.charCodeAt(c) & 1);
      held += 1;
      if (held === 8) {
        out[pos] = accumulator & 0xff;
        pos += 1;
        accumulator = 0;
        held = 0;
      }
    }
  }
  // Whatever is left over is padded with zeros to fill the last byte.
  if (held > 0) out[pos] = (accumulator << (8 - held)) & 0xff;
  return out;
}

/* ---------------------------------------------------------------- decode */

/**
 * Read the original bytes back out of a bit stream.
 *
 * O(N) — one step per bit, and one step per symbol produced.
 *
 * Short codes get a lookup table, so the common case reads eight bits
 * at a time instead of one. Long codes fall back to walking the tree,
 * because they cannot be looked up in eight bits.
 *
 * @param {Uint8Array} payload
 * @param {{left: Int32Array, right: Int32Array, symbol: Int16Array, rootIndex: number}} tree
 * @param {number} originalSize
 * @returns {Uint8Array}
 */
export function decode(payload, tree, originalSize) {
  const out = new Uint8Array(originalSize);
  if (originalSize === 0) return out;
  if (tree.rootIndex < 0) {
    throw new Error("no tree to decode with");
  }

  const { left, right, symbol } = tree;
  const totalBits = payload.length * 8;

  // Eight-bit lookup for the codes short enough to fit in it.
  //
  // A code shorter than eight bits is matched on its *prefix*: the eight
  // bits at the code boundary start with the code, and the rest of them
  // belong to whatever comes next. So a three-bit code is registered
  // under all five of the eight-bit values that begin with it — eight
  // bits minus three.
  const fastSymbol = new Int16Array(256).fill(-1);
  const fastLength = new Uint8Array(256);
  const codes = generateCodesFromFlat(tree);
  for (const [sym, code] of codes) {
    if (code.length > 8) continue;
    const value = parseInt(code, 2);
    const repeats = 1 << (8 - code.length);
    const base = value << (8 - code.length);
    for (let i = 0; i < repeats; i += 1) {
      const slot = base + i;
      fastSymbol[slot] = sym;
      fastLength[slot] = code.length;
    }
  }

  let node = tree.rootIndex;
  let produced = 0;
  let bitPos = 0;

  while (produced < originalSize && bitPos < totalBits) {
    // Fast path: eight bits of the stream are already in a table.
    //
    // It is only safe at a code boundary. The table matches the next
    // eight bits against the codes that fit in eight bits, and that
    // only means something when the next code starts here. Part-way
    // through a longer code those eight bits are the tail of one code
    // and the head of the next, and they can match a table entry by
    // accident — which is how an 'H' came back as an 'a'.
    //
    // `node` is at the root exactly when the next code starts here.
    if (node === tree.rootIndex && bitPos + 8 <= totalBits) {
      const byteIndex = bitPos >> 3;
      const offset = bitPos & 7;
      let window = payload[byteIndex] << 8;
      if (byteIndex + 1 < payload.length) window |= payload[byteIndex + 1];
      const chunk = (window >> (8 - offset)) & 0xff;
      const len = fastLength[chunk];
      if (len > 0) {
        out[produced] = fastSymbol[chunk];
        produced += 1;
        bitPos += len;
        continue;
      }
    }

    // Slow path: one bit at a time, down the tree.
    const bit = (payload[bitPos >> 3] >> (7 - (bitPos & 7))) & 1;
    bitPos += 1;
    node = bit ? right[node] : left[node];
    if (symbol[node] >= 0) {
      out[produced] = symbol[node];
      produced += 1;
      node = tree.rootIndex;
    }
  }

  return out;
}

/** The codes of a flattened tree, recovered by walking it. */
function generateCodesFromFlat(tree) {
  const codes = new Map();
  if (tree.rootIndex < 0) return codes;
  const { left, right, symbol } = tree;
  const stack = [[tree.rootIndex, ""]];
  while (stack.length > 0) {
    const [index, prefix] = stack.pop();
    if (symbol[index] >= 0) {
      codes.set(symbol[index], prefix || "0");
      continue;
    }
    stack.push([left[index], `${prefix}0`]);
    stack.push([right[index], `${prefix}1`]);
  }
  return codes;
}

/* ------------------------------------------------------- tree on the wire */

/**
 * Write the tree down.
 *
 * A preorder walk: an internal node is one byte, `0x01`; a leaf is two
 * bytes, `0x00` and the symbol. The shape of the tree is in the shape
 * of the bytes, so nothing has to be looked up to read it back.
 *
 * @param {object|null} root
 * @returns {Uint8Array}
 */
export function serializeTree(root) {
  if (!root) return new Uint8Array(0);
  const out = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.symbol >= 0) {
      out.push(0x00, node.symbol);
    } else {
      out.push(0x01);
      stack.push(node.right);
      stack.push(node.left);
    }
  }
  return new Uint8Array(out);
}

/**
 * Read the tree back.
 *
 * @param {Uint8Array} bytes
 * @returns {object|null}
 */
export function deserializeTree(bytes) {
  if (!bytes || bytes.length === 0) return null;
  let cursor = 0;

  function read() {
    if (cursor >= bytes.length) throw new Error("the tree is truncated");
    const flag = bytes[cursor];
    cursor += 1;
    if (flag === 0x00) {
      if (cursor >= bytes.length) throw new Error("the tree is truncated");
      const symbol = bytes[cursor];
      cursor += 1;
      return { symbol, freq: 0, left: null, right: null, serial: symbol };
    }
    if (flag !== 0x01) throw new Error(`unknown tree node ${flag}`);
    const left = read();
    const right = read();
    return {
      symbol: -1,
      freq: left.freq + right.freq,
      left,
      right,
      serial: -1,
    };
  }

  const root = read();
  if (cursor !== bytes.length) throw new Error("the tree has trailing bytes");
  return root;
}

/* ---------------------------------------------------------- the container */

/** "UHC1" — the magic at the head of every stored file. */
export const CONTAINER_MAGIC = [0x55, 0x48, 0x43, 0x31];
/** The container format version. */
export const CONTAINER_VERSION = 1;

/**
 * Pack the tree and the bit stream into one block.
 *
 * The block says what it is, how big the original was, how big the tree
 * is and where the payload starts. Everything needed to read the file
 * back is inside it.
 *
 * @param {{ originalSize: number, tree: object|null, payload: Uint8Array }} parts
 * @returns {Uint8Array}
 */
export function packContainer({ originalSize, tree, payload }) {
  const treeBytes = serializeTree(tree);
  const header = 14;
  const out = new Uint8Array(header + treeBytes.length + payload.length);
  out.set(CONTAINER_MAGIC, 0);
  out[4] = CONTAINER_VERSION;
  out[5] = 0; // reserved
  writeUint32(out, 6, originalSize);
  writeUint32(out, 10, treeBytes.length);
  out.set(treeBytes, header);
  out.set(payload, header + treeBytes.length);
  return out;
}

/**
 * Unpack a block into the tree and the bit stream.
 *
 * @param {Uint8Array} bytes
 * @returns {{ originalSize: number, tree: object|null, payload: Uint8Array }}
 */
export function unpackContainer(bytes) {
  if (!bytes || bytes.length < 14) throw new Error("that is not a UniCompress file");
  for (let i = 0; i < CONTAINER_MAGIC.length; i += 1) {
    if (bytes[i] !== CONTAINER_MAGIC[i]) {
      throw new Error("that is not a UniCompress file");
    }
  }
  const version = bytes[4];
  if (version !== CONTAINER_VERSION) {
    throw new Error(`unsupported UniCompress version ${version}`);
  }
  const originalSize = readUint32(bytes, 6);
  const treeLength = readUint32(bytes, 10);
  const header = 14;
  if (bytes.length < header + treeLength) throw new Error("the file is truncated");
  const tree = deserializeTree(bytes.subarray(header, header + treeLength));
  const payload = bytes.subarray(header + treeLength);
  return { originalSize, tree, payload };
}

/* ------------------------------------------------------------------- api */

function writeUint32(out, offset, value) {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

function readUint32(bytes, offset) {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  );
}

/**
 * Compress a buffer.
 *
 * @param {Uint8Array} bytes
 * @returns {{
 *   container: Uint8Array,
 *   originalSize: number,
 *   compressedSize: number,
 *   savedBytes: number,
 *   ratio: number,
 *   savedPercent: number,
 *   counts: Uint32Array,
 *   codes: Map<number, string>,
 *   root: object|null,
 *   steps: object[],
 *   treeBytes: number,
 *   encodingMs: number,
 * }}
 */
export function compress(bytes) {
  const started = performance.now();
  const counts = byteFrequencies(bytes);
  const { root, steps } = buildHuffmanTree(counts, { recordSteps: true });
  const codes = generateCodes(root);

  const payload = root ? encode(bytes, codes) : new Uint8Array(0);
  const container = packContainer({ originalSize: bytes.length, tree: root, payload });
  const encodingMs = performance.now() - started;

  const originalSize = bytes.length;
  const compressedSize = container.length;
  const savedBytes = originalSize - compressedSize;

  return {
    container,
    originalSize,
    compressedSize,
    savedBytes,
    // The ratio is against the original. A file that grew still has a
    // ratio — a number above 1 — and the caller is told.
    ratio: originalSize === 0 ? 1 : compressedSize / originalSize,
    savedPercent: originalSize === 0 ? 0 : (savedBytes / originalSize) * 100,
    counts,
    codes,
    root,
    steps,
    treeBytes: serializeTree(root).length,
    encodingMs,
  };
}

/**
 * Decompress a buffer that `compress` produced.
 *
 * @param {Uint8Array} container
 * @returns {{ bytes: Uint8Array, originalSize: number, decodingMs: number }}
 */
export function decompress(container) {
  const started = performance.now();
  const { originalSize, tree, payload } = unpackContainer(container);
  const flat = flattenTree(tree);
  const bytes = decode(payload, flat, originalSize);
  return { bytes, originalSize, decodingMs: performance.now() - started };
}

/**
 * Compress and decompress in one go, and check the result.
 *
 * This is the honest test of the engine: the bytes that come back are
 * compared with the bytes that went in, one by one.
 *
 * @param {Uint8Array} bytes
 */
export function roundTrip(bytes) {
  const compressed = compress(bytes);
  const restored = decompress(compressed.container);
  const identical =
    restored.bytes.length === bytes.length &&
    restored.bytes.every((byte, i) => byte === bytes[i]);
  return {
    ...compressed,
    restored: restored.bytes,
    decodingMs: restored.decodingMs,
    identical,
  };
}
