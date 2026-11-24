// UniCompress — the part that talks to the rest of UniHaat.
//
// The engine lives in `huffman.js` and knows nothing about the app.
// This module knows about the app and nothing about the algorithm: it
// reads a file, optimises it, compresses it, stores it, and reads it
// back.
//
// Two rules shape the design:
//
//   * The photograph a buyer sees is the *decompressed* blob. What is
//     stored is the compressed one. Nothing is kept twice, and nothing
//     is silently re-encoded on the way out — the bytes that come back
//     are the bytes that went in.
//
//   * A file that compresses to *more* than it started with is still
//     stored compressed, but the numbers say so. Huffman coding has to
//     pay for the tree it carries, and on a tiny or already-random
//     file that bill can be more than the rent. The dashboard reports
//     it rather than hiding it.

import { compress, decompress, byteFrequencies } from "./huffman.js";
import * as SB from "./supabase.js";

/* --------------------------------------------------------------- helpers */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/**
 * The picture a listing shows when it has none of its own.
 *
 * The same one the rest of the app falls back to, so a listing whose
 * photo cannot be rebuilt looks like every other listing without one.
 */
export const FALLBACK_IMAGE = "./assets/table-chair.svg";

const bytesToBase64 = (bytes) => {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const base64ToBytes = (text) => {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
};

/** A readable size. */
export function formatBytes(n) {
  const value = Number(n) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

/** A byte value as the character it stands for, when it is printable. */
function byteLabel(value) {
  if (value === 32) return "space";
  if (value === 10) return "\\n";
  if (value === 13) return "\\r";
  if (value === 9) return "\\t";
  if (value >= 33 && value <= 126) return String.fromCharCode(value);
  return `0x${value.toString(16).padStart(2, "0")}`;
}

/* ------------------------------------------------------- image preparation */

/**
 * Prepare an image for compression.
 *
 * A photograph off a modern phone is several megabytes of pixels that
 * the marketplace will never show at full size. It is scaled down to
 * the largest size the site actually renders and re-encoded as JPEG,
 * which is where nearly all of the saving comes from — Huffman coding
 * alone saves very little on an image that has already been through a
 * lossy codec.
 *
 * The result is reported honestly: `optimized` says whether anything
 * was done, and `originalBytes` / `optimizedBytes` say by how much.
 *
 * A file that is not an image is passed through untouched.
 *
 * @param {File} file
 * @returns {Promise<{ bytes: Uint8Array, mimeType: string, originalBytes: number, optimizedBytes: number, optimized: boolean }>}
 */
export async function prepareImage(file) {
  const raw = new Uint8Array(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";

  if (!mimeType.startsWith("image/")) {
    return {
      bytes: raw,
      mimeType,
      originalBytes: raw.length,
      optimizedBytes: raw.length,
      optimized: false,
    };
  }

  // The site renders a listing image at most this wide. Anything
  // bigger is pixels nobody sees.
  const MAX_EDGE = 1600;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    // A transparent PNG flattened onto white: the marketplace shows a
    // white card, and JPEG has no alpha channel to keep.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();

    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    if (!blob) throw new Error("the browser could not re-encode the image");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Re-encoding can make a file *bigger* — a small PNG of flat colour
    // becomes a larger JPEG. Keeping the original is then the honest
    // choice, and the dashboard says the image was left alone.
    if (bytes.length >= raw.length) {
      return {
        bytes: raw,
        mimeType,
        originalBytes: raw.length,
        optimizedBytes: raw.length,
        optimized: false,
      };
    }

    return {
      bytes,
      mimeType: "image/jpeg",
      originalBytes: raw.length,
      optimizedBytes: bytes.length,
      optimized: true,
    };
  } catch (err) {
    // A browser that cannot decode the image (or a canvas that is not
    // available) must not lose the upload. The original goes through.
    console.warn("[UniCompress] could not optimise the image:", err?.message);
    return {
      bytes: raw,
      mimeType,
      originalBytes: raw.length,
      optimizedBytes: raw.length,
      optimized: false,
    };
  }
}

/* ------------------------------------------------------------ compression */

/**
 * Compress a file and describe what happened.
 *
 * @param {File} file
 * @returns {Promise<object>}
 */
export async function compressFile(file) {
  const prepared = await prepareImage(file);
  const result = compress(prepared.bytes);

  // Read it back and compare, byte for byte. A compressor that cannot
  // reproduce its input is not a compressor.
  const restored = decompress(result.container);
  const identical =
    restored.bytes.length === prepared.bytes.length &&
    restored.bytes.every((byte, i) => byte === prepared.bytes[i]);

  return {
    ...result,
    fileName: file.name || "upload",
    mimeType: prepared.mimeType,
    originalBytes: prepared.originalBytes,
    optimizedBytes: prepared.optimizedBytes,
    optimized: prepared.optimized,
    restoredBytes: restored.bytes,
    decodingMs: restored.decodingMs,
    identical,
    // The blob that would be stored: the tree and the bit stream.
    payload: result.container,
  };
}

/**
 * The numbers the dashboard shows, worked out so each one says what it
 * is measured against.
 *
 * Three sizes are in play and they are easy to confuse:
 *
 *   * the file the student picked,
 *   * the file after the standard image optimisation,
 *   * the blob that is actually stored.
 *
 * Most of the saving on a photograph comes from the first step — scaling
 * and re-encoding it — and only a little from the Huffman coding. The
 * headline is the total, because that is what the campus really keeps,
 * but the Huffman step is reported on its own so nobody is told the
 * algorithm did more than it did.
 *
 * A file that grows is reported as a growth, with a minus sign.
 *
 * @param {object} compressed
 */
export function compressionMetrics(compressed) {
  const original = Number(compressed.originalBytes) || 0;
  const optimised = Number(compressed.optimizedBytes) || 0;
  const stored = Number(compressed.payload?.length) || 0;

  const savedBytes = original - stored;
  const savedPercent = original ? (savedBytes / original) * 100 : 0;

  // The Huffman step alone, measured against the bytes it was given.
  const huffmanSavedBytes = optimised - stored;
  const huffmanSavedPercent = optimised ? (huffmanSavedBytes / optimised) * 100 : 0;

  return {
    originalBytes: original,
    optimizedBytes: optimised,
    storedBytes: stored,
    savedBytes,
    savedPercent,
    ratio: original ? stored / original : 1,
    // The share of the file that survived, against the optimised bytes.
    huffmanRatio: optimised ? stored / optimised : 1,
    huffmanSavedBytes,
    huffmanSavedPercent,
    optimized: Boolean(compressed.optimized),
    // True when the Huffman step alone made the file bigger. That is
    // the case the dashboard has to call out rather than smooth over.
    grew: stored > optimised,
  };
}

/**
 * The tree as the database wants it: a map of byte value to code.
 */
export function treeToJson(codes) {
  const tree = {};
  for (const [symbol, code] of codes) tree[symbol] = code;
  return tree;
}

/** The length of every code, so the server can check the tree. */
export function codeLengthsToJson(codes) {
  const lengths = {};
  for (const [symbol, code] of codes) lengths[symbol] = code.length;
  return lengths;
}

/**
 * Rebuild the codes from the tree the server stored.
 *
 * @param {Record<string, string>} tree
 * @returns {Map<number, string>}
 */
export function treeFromJson(tree) {
  const codes = new Map();
  for (const [symbol, code] of Object.entries(tree ?? {})) {
    codes.set(Number(symbol), code);
  }
  return codes;
}

/* ------------------------------------------------------------- the storage */

/**
 * Store a compressed image with a listing.
 *
 * @param {{listingId: string, compressed: object }} parts
 */
export async function storeListingImage({ listingId, compressed }) {
  if (!SB.isSignedIn()) return null;
  try {
    const row = await SB.putListingImageBlob({
      listingId,
      // The container: the tree and the bit stream, which is exactly
      // what is stored.
      payload: bytesToBase64(compressed.payload),
      tree: treeToJson(compressed.codes),
      codeLengths: codeLengthsToJson(compressed.codes),
      originalBytes: compressed.originalBytes,
      // The size the server will check the payload against, so it has
      // to be the size of the payload and nothing else.
      compressedBytes: compressed.payload.length,
      mimeType: compressed.mimeType,
      fileName: compressed.fileName,
      encodingMs: compressed.encodingMs,
      verified: compressed.identical,
    });
    return row;
  } catch (err) {
    console.warn("[UniCompress] could not store the image:", err?.message);
    return null;
  }
}

/**
 * Read a listing's compressed image back and rebuild the file.
 *
 * The blob is fetched, the tree is read, and the bytes are put back
 * together. The result is a Blob URL the browser can show.
 *
 * @param {string} listingId
 * @returns {Promise<{ url: string, bytes: Uint8Array, identical: boolean }|null>}
 */
export async function loadListingImage(listingId) {
  try {
    const row = await SB.getListingImageBlob(listingId);
    if (!row?.payload) return null;

    const container = base64ToBytes(row.payload);
    const { bytes, decodingMs } = decompress(container);
    const blob = new Blob([bytes], { type: row.mime_type || "image/jpeg" });
    return {
      url: URL.createObjectURL(blob),
      bytes,
      decodingMs,
      identical: bytes.length === Number(row.original_bytes),
    };
  } catch (err) {
    console.warn("[UniCompress] could not load the image:", err?.message);
    return null;
  }
}

/**
 * Record a compression in the student's history.
 */
export async function recordCompression(compressed) {
  if (!SB.isSignedIn()) return null;
  try {
    return await SB.recordCompression({
      fileName: compressed.fileName,
      mimeType: compressed.mimeType,
      originalBytes: compressed.originalBytes,
      compressedBytes: compressed.payload.length,
      encodingMs: compressed.encodingMs,
      decodingMs: compressed.decodingMs,
      codec: "huffman",
    });
  } catch (err) {
    console.warn("[UniCompress] could not record the compression:", err?.message);
    return null;
  }
}

/* ------------------------------------------------------------- hydration */

/**
 * Put back together the photos that were stored compressed.
 *
 * A listing whose picture was compressed does not point at a URL — it
 * points at a marker. The browser fetches the blob, decodes it, and
 * replaces the marker with an object URL the `<img>` can show.
 *
 * A blob that cannot be fetched leaves the listing with the fallback
 * illustration rather than with the marker. The marker is not a URL:
 * leaving it there would put a broken image on the card, and a broken
 * photo is worse than the picture the catalogue always had.
 *
 * @param {object[]} listings
 * @returns {Promise<object[]>} the same listings
 */
export async function hydrateCompressedImages(listings) {
  const compressed = (listings || []).filter((l) => l?.imgCodec === "huffman");
  if (!compressed.length) return listings;

  await Promise.all(
    compressed.map(async (listing) => {
      try {
        const loaded = await loadListingImage(listing.id);
        if (loaded?.url) {
          listing.img = loaded.url;
          listing.imgDecoded = true;
          return;
        }
      } catch (err) {
        console.warn(
          `[UniCompress] could not rebuild the photo for listing ${listing.id}:`,
          err?.message
        );
      }
      // The blob is not there. Show the fallback rather than a marker
      // the browser would try to fetch and fail.
      listing.img = FALLBACK_IMAGE;
      listing.imgDecoded = false;
    })
  );
  return listings;
}

/* ----------------------------------------------------------- the dashboard */

/**
 * The frequency table, ready to draw.
 *
 * @param {Uint8Array} bytes
 */
export function frequencyTable(bytes) {
  const counts = byteFrequencies(bytes);
  const rows = [];
  for (let value = 0; value < counts.length; value += 1) {
    if (counts[value] === 0) continue;
    rows.push({
      value,
      label: byteLabel(value),
      count: counts[value],
      percent: bytes.length ? (counts[value] / bytes.length) * 100 : 0,
    });
  }
  rows.sort((a, b) => b.count - a.count || a.value - b.value);
  return rows;
}

/**
 * The priority queue, step by step.
 *
 * The queue is what the greedy algorithm consumes: the two smallest
 * entries are taken out and joined into one. Each step shows the queue
 * as it was before that round.
 */
export function priorityQueueSteps(steps, root) {
  // Rebuild the queue as the algorithm saw it: start with the leaves,
  // then add each parent as it is made.
  const leaves = [];
  const walk = (node) => {
    if (!node) return;
    if (node.symbol >= 0) {
      leaves.push({ freq: node.freq, label: byteLabel(node.symbol), symbol: node.symbol });
      return;
    }
    walk(node.left);
    walk(node.right);
  };
  walk(root);

  const queue = leaves
    .slice()
    .sort((a, b) => a.freq - b.freq || a.symbol - b.symbol)
    .map((entry) => ({ ...entry, state: "waiting" }));

  const rounds = [];
  for (const step of steps) {
    const before = queue
      .slice()
      .sort((a, b) => a.freq - b.freq || a.symbol - b.symbol)
      .map((entry) => ({ ...entry }));
    const taken = before.slice(0, 2);
    rounds.push({
      merged: taken.map((entry) => entry.label),
      parentFreq: step.parent.freq,
      before,
      after: [
        ...before.slice(2),
        { freq: step.parent.freq, label: `(${taken.map((t) => t.label).join(" + ")})`, symbol: -1 },
      ].sort((a, b) => a.freq - b.freq || a.symbol - b.symbol),
    });
  }
  return { initial: queue, rounds };
}

/**
 * The tree, as nodes and edges, ready to draw.
 */
export function treeToNodes(root) {
  if (!root) return { nodes: [], edges: [] };
  const nodes = [];
  const edges = [];
  const walk = (node, depth, path) => {
    if (!node) return;
    const id = path || "r";
    if (node.symbol >= 0) {
      nodes.push({
        id,
        label: byteLabel(node.symbol),
        value: node.symbol,
        freq: node.freq,
        depth,
        leaf: true,
      });
      return;
    }
    nodes.push({ id, label: "", freq: node.freq, depth, leaf: false });
    walk(node.left, depth + 1, `${id}l`);
    walk(node.right, depth + 1, `${id}r`);
    edges.push({ from: id, to: `${id}l`, bit: "0" });
    edges.push({ from: id, to: `${id}r`, bit: "1" });
  };
  walk(root, 0, "r");
  return { nodes, edges };
}

/**
 * The first few bytes of the input, with the code each one becomes.
 *
 * This is the encoding process, shown rather than described.
 */
export function encodingWalkthrough(bytes, codes, limit = 24) {
  const rows = [];
  let bitLength = 0;
  for (let i = 0; i < Math.min(bytes.length, limit); i += 1) {
    const code = codes.get(bytes[i]) ?? "";
    bitLength += code.length;
    rows.push({
      index: i,
      value: bytes[i],
      label: byteLabel(bytes[i]),
      code,
      bits: code.length,
    });
  }
  return { rows, bitLength, shown: Math.min(bytes.length, limit) };
}

/**
 * The decoding process, shown rather than described.
 *
 * The first symbols are read back out of the bit stream, one bit at a
 * time, and the tree walk is shown.
 */
export function decodingWalkthrough(bytes, codes, limit = 12) {
  const rows = [];
  let bitBuffer = "";
  let symbolCount = 0;
  for (let i = 0; i < bytes.length && rows.length < limit; i += 1) {
    const code = codes.get(bytes[i]);
    if (code === undefined) break;
    bitBuffer += code;
    // A code is complete when it is not the prefix of a longer one.
    const isPrefix = [...codes.values()].some((other) => other.length > code.length && other.startsWith(code));
    if (!isPrefix) {
      symbolCount += 1;
      rows.push({ index: symbolCount - 1, label: byteLabel(bytes[i]), code, bits: code.length });
      bitBuffer = "";
    }
  }
  return { rows, symbolCount };
}

/**
 * The complexity of each step, in the terms of the course.
 */
export const COMPLEXITY = [
  { step: "Frequency calculation", detail: "one pass over the bytes, counting each one", complexity: "O(N)", symbol: "N" },
  { step: "Priority queue", detail: "a min-heap; taking the smallest is logarithmic", complexity: "O(log K)", symbol: "K" },
  { step: "Tree construction", detail: "K leaves joined, two at a time", complexity: "O(K log K)", symbol: "K" },
  { step: "Code generation", detail: "one walk of the finished tree", complexity: "O(K)", symbol: "K" },
  { step: "Encoding", detail: "every byte rewritten as its code", complexity: "O(N)", symbol: "N" },
  { step: "Decoding", detail: "one step per bit, one per symbol produced", complexity: "O(N)", symbol: "N" },
];

/* ------------------------------------------------------------ the section */

/**
 * Wire the UniCompress section.
 *
 * @param {{ toast?: (message: string) => void }} options
 */
export function initUniCompress({ toast = () => {} } = {}) {
  const section = $("#unicompress");
  if (!section) return;

  const state = {
    compressed: null,
    originalUrl: null,
    restoredUrl: null,
    history: [],
  };

  /* ---- the file picker ---- */

  const fileInput = $("#ucFile");
  const dropZone = $("#ucDrop");

  async function handleFile(file) {
    if (!file) return;
    const status = $("#ucStatus");
    status.textContent = `Compressing ${file.name}…`;
    status.dataset.state = "busy";

    try {
      const compressed = await compressFile(file);

      // The original, shown beside the reconstruction.
      if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);
      if (state.restoredUrl) URL.revokeObjectURL(state.restoredUrl);
      state.originalUrl = URL.createObjectURL(file);
      state.restoredUrl = URL.createObjectURL(
        new Blob([compressed.restoredBytes], { type: compressed.mimeType })
      );
      state.compressed = compressed;

      renderDashboard(compressed);
      renderVisualization(compressed);
      status.textContent = compressed.identical
        ? `${file.name} — compressed and verified byte for byte`
        : `${file.name} — the reconstruction did not match the original`;
      status.dataset.state = compressed.identical ? "ok" : "bad";

      await recordCompression(compressed);
      await loadHistory();
      await loadCampusTotals();
    } catch (err) {
      console.warn("[UniCompress] could not compress the file:", err?.message);
      status.textContent = `Could not compress that file — ${err.message}`;
      status.dataset.state = "bad";
    }
  }

  fileInput?.addEventListener("change", (e) => handleFile(e.target.files?.[0]));

  dropZone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.dataset.drag = "yes";
  });
  dropZone?.addEventListener("dragleave", () => {
    dropZone.dataset.drag = "no";
  });
  dropZone?.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.dataset.drag = "no";
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  /* ---- the dashboard ---- */

  function renderDashboard(compressed) {
    const set = (id, value) => {
      const el = $(id);
      if (el) el.textContent = value;
    };

    const m = compressionMetrics(compressed);

    set("#ucOriginalSize", formatBytes(m.originalBytes));
    set("#ucCompressedSize", formatBytes(m.storedBytes));
    set(
      "#ucOptimizedSize",
      m.optimized ? formatBytes(m.optimizedBytes) : "not applied"
    );
    set(
      "#ucSaved",
      `${m.savedBytes >= 0 ? "" : "−"}${formatBytes(Math.abs(m.savedBytes))}`
    );
    set("#ucSavedPercent", `${m.savedPercent.toFixed(1)}%`);

    const ratioEl = $("#ucRatio");
    if (ratioEl) {
      ratioEl.textContent = `${(m.ratio * 100).toFixed(1)}%`;
      // A file that grew is reported as it happened. The tree the
      // compressor carries costs more than the file was worth.
      ratioEl.dataset.grew = m.ratio > 1 ? "yes" : "no";
    }

    set("#ucEncodingMs", `${compressed.encodingMs.toFixed(2)} ms`);
    set("#ucDecodingMs", `${compressed.decodingMs.toFixed(2)} ms`);

    // What the Huffman step did on its own, apart from the image
    // optimisation. The headline above is the total saving; this is
    // the part the algorithm is responsible for.
    const huffmanEl = $("#ucHuffmanSaving");
    if (huffmanEl) {
      huffmanEl.textContent =
        `${m.huffmanSavedBytes >= 0 ? "" : "−"}${formatBytes(Math.abs(m.huffmanSavedBytes))}` +
        ` (${m.huffmanSavedPercent.toFixed(1)}%)`;
      huffmanEl.dataset.grew = m.grew ? "yes" : "no";
    }

    const verdict = $("#ucVerdict");
    if (verdict) {
      if (compressed.identical) {
        verdict.textContent =
          "The reconstruction matches the original byte for byte.";
        verdict.dataset.ok = "yes";
      } else {
        verdict.textContent =
          "The reconstruction does not match the original — the file was not stored.";
        verdict.dataset.ok = "no";
      }
    }

    // The two pictures.
    const original = $("#ucOriginalImage");
    const restored = $("#ucRestoredImage");
    if (original) original.src = state.originalUrl ?? "";
    if (restored) restored.src = state.restoredUrl ?? "";

    const compare = $("#ucCompare");
    if (compare) compare.hidden = false;

    // A file that grew is called out in words, not only in a colour.
    const note = $("#ucGrewNote");
    if (note) {
      if (m.grew) {
        note.hidden = false;
        note.textContent =
          `Huffman coding made this file bigger on its own: ${formatBytes(m.optimizedBytes)} became ${formatBytes(m.storedBytes)}. The tree it has to carry costs more than the file was worth — that happens with very small files and with files whose bytes are already close to random. The dashboard reports the loss rather than hiding it.`;
      } else {
        note.hidden = true;
      }
    }
  }

  /* ---- the campus total ---- */

  /**
   * What the whole campus has saved.
   *
   * The server counts the rows and hands back sums. It never hands
   * back a row, so nobody learns what anybody else compressed.
   */
  async function loadCampusTotals() {
    const panel = $("#ucCampus");
    if (!panel) return;

    let totals = null;
    try {
      totals = await SB.fetchCompressionTotals();
    } catch (err) {
      console.warn("[UniCompress] could not read the campus totals:", err?.message);
      return;
    }
    if (!totals) return;

    const files = Number(totals.files) || 0;
    const original = Number(totals.original_bytes) || 0;
    const stored = Number(totals.compressed_bytes) || 0;
    const saved = Number(totals.saved_bytes) || 0;
    const percent = totals.saved_percent === null ? null : Number(totals.saved_percent);

    const set = (id, value) => {
      const el = $(id);
      if (el) el.textContent = value;
    };

    set("#ucCampusFiles", String(files));
    set("#ucCampusOriginal", formatBytes(original));
    set("#ucCampusStored", formatBytes(stored));
    set("#ucCampusSaved", formatBytes(saved));
    set("#ucCampusPercent", percent === null ? "—" : `${percent.toFixed(1)}%`);

    // Nothing has been counted yet — say so rather than showing zeroes
    // as though they were a record.
    panel.hidden = files === 0;
  }

  /* ---- the DAA visualisation ---- */

  function renderVisualization(compressed) {
    const bytes = compressed.restoredBytes;
    const codes = compressed.codes;

    // The frequency table.
    const freqBody = $("#ucFreqBody");
    if (freqBody) {
      const rows = frequencyTable(bytes);
      freqBody.innerHTML = rows
        .slice(0, 24)
        .map(
          (row) => `<tr>
            <td class="mono">${row.value}</td>
            <td>${escapeHtml(row.label)}</td>
            <td class="mono">${row.count}</td>
            <td class="mono">${row.percent.toFixed(2)}%</td>
            <td><span class="uc-bar"><i style="width:${Math.max(2, row.percent).toFixed(1)}%"></i></span></td>
          </tr>`
        )
        .join("");
      const more = $("#ucFreqMore");
      if (more) {
        const hidden = rows.length - 24;
        more.textContent = hidden > 0 ? `+${hidden} more distinct byte values` : "";
      }
    }

    // The priority queue and the tree.
    const { initial, rounds } = priorityQueueSteps(compressed.steps, compressed.root);
    const queueEl = $("#ucQueue");
    if (queueEl) {
      const shown = initial.slice(0, 12);
      queueEl.innerHTML = shown
        .map(
          (entry) =>
            `<span class="uc-chip"><b>${escapeHtml(entry.label)}</b> ${entry.freq}</span>`
        )
        .join("");
      const rest = initial.length - shown.length;
      const restEl = $("#ucQueueMore");
      if (restEl) restEl.textContent = rest > 0 ? `+${rest} more in the queue` : "";
    }

    const roundsEl = $("#ucRounds");
    if (roundsEl) {
      roundsEl.innerHTML = rounds
        .slice(0, 10)
        .map(
          (round, i) => `<li>
            <span class="mono">${i + 1}</span>
            take <b>${escapeHtml(round.merged[0] ?? "?")}</b> and <b>${escapeHtml(round.merged[1] ?? "?")}</b>
            → one entry of weight <b>${round.parentFreq}</b>
            <span class="fine">(${round.before.length} in the queue before)</span>
          </li>`
        )
        .join("");
    }

    const treeEl = $("#ucTree");
    if (treeEl) {
      const { nodes, edges } = treeToNodes(compressed.root);
      treeEl.innerHTML = renderTree(nodes, edges);
    }

    // The codes.
    const codesEl = $("#ucCodes");
    if (codesEl) {
      const rows = [...codes.entries()]
        .sort((a, b) => b[1].length - a[1].length || a[0] - b[0])
        .slice(0, 24);
      codesEl.innerHTML = rows
        .map(
          ([value, code]) => `<tr>
            <td class="mono">${value}</td>
            <td>${escapeHtml(byteLabel(value))}</td>
            <td class="mono uc-code">${code}</td>
            <td class="mono">${code.length}</td>
          </tr>`
        )
        .join("");
    }

    // The encoding and the decoding, shown.
    const encEl = $("#ucEncoding");
    if (encEl) {
      const { rows, bitLength, shown } = encodingWalkthrough(bytes, codes);
      encEl.innerHTML = rows
        .map(
          (row) => `<tr>
            <td class="mono">${row.index}</td>
            <td class="mono">${row.value}</td>
            <td>${escapeHtml(row.label)}</td>
            <td class="mono uc-code">${row.code}</td>
            <td class="mono">${row.bits}</td>
          </tr>`
        )
        .join("");
      const summary = $("#ucEncodingSummary");
      if (summary) {
        summary.textContent = `${shown} byte${shown === 1 ? "" : "s"} shown · ${bitLength} bits`;
      }
    }

    const decEl = $("#ucDecoding");
    if (decEl) {
      const { rows, symbolCount } = decodingWalkthrough(bytes, codes);
      decEl.innerHTML = rows
        .map(
          (row) => `<tr>
            <td class="mono">${row.index}</td>
            <td>${escapeHtml(row.label)}</td>
            <td class="mono uc-code">${row.code}</td>
            <td class="mono">${row.bits}</td>
          </tr>`
        )
        .join("");
      const summary = $("#ucDecodingSummary");
      if (summary) {
        summary.textContent = `${symbolCount} symbol${symbolCount === 1 ? "" : "s"} read back`;
      }
    }
  }

  /** The tree as SVG. */
  function renderTree(nodes, edges) {
    if (!nodes.length) return `<p class="fine">This file is empty, so there is no tree.</p>`;

    // Lay the tree out: leaves are spread evenly, each parent sits
    // above the middle of its children.
    const leaves = nodes.filter((n) => n.leaf);
    const width = Math.max(320, leaves.length * 46);
    const maxDepth = Math.max(...nodes.map((n) => n.depth));
    const height = (maxDepth + 1) * 54 + 30;

    const pos = new Map();
    let cursor = 0;
    const place = (id) => {
      const node = nodes.find((n) => n.id === id);
      if (!node) return 0;
      if (node.leaf) {
        const x = leaves.length === 1 ? width / 2 : 30 + cursor * ((width - 60) / Math.max(1, leaves.length - 1));
        cursor += 1;
        pos.set(id, { x, y: 24 + node.depth * 54 });
        return x;
      }
      const left = place(`${id}l`);
      const right = place(`${id}r`);
      const x = (left + right) / 2;
      pos.set(id, { x, y: 24 + node.depth * 54 });
      return x;
    };
    place("r");

    const parts = [];
    for (const edge of edges) {
      const from = pos.get(edge.from);
      const to = pos.get(edge.to);
      if (!from || !to) continue;
      parts.push(
        `<line x1="${from.x.toFixed(1)}" y1="${from.y}" x2="${to.x.toFixed(1)}" y2="${to.y}" stroke="currentColor" stroke-width="1" opacity=".35" />`
      );
      parts.push(
        `<text x="${((from.x + to.x) / 2).toFixed(1)}" y="${((from.y + to.y) / 2 - 3).toFixed(1)}" class="uc-bit" text-anchor="middle">${edge.bit}</text>`
      );
    }
    for (const node of nodes) {
      const p = pos.get(node.id);
      if (!p) continue;
      if (node.leaf) {
        parts.push(
          `<circle cx="${p.x.toFixed(1)}" cy="${p.y}" r="12" class="uc-leaf" />`
        );
        parts.push(
          `<text x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" class="uc-leaf-label" text-anchor="middle">${escapeHtml(node.label.slice(0, 3))}</text>`
        );
      } else {
        parts.push(
          `<circle cx="${p.x.toFixed(1)}" cy="${p.y}" r="7" class="uc-node" />`
        );
      }
    }

    return `<svg viewBox="0 0 ${width} ${height}" class="uc-tree" role="img" aria-label="The Huffman tree">${parts.join("")}</svg>`;
  }

  /* ---- the history ---- */

  async function loadHistory() {
    const body = $("#ucHistoryBody");
    if (!body) return;
    if (!SB.isSignedIn()) {
      body.innerHTML = `<tr><td colspan="5" class="fine">Sign in to keep a history of what you have compressed.</td></tr>`;
      return;
    }
    try {
      const rows = await SB.fetchCompressionHistory(20);
      state.history = rows ?? [];
      if (!state.history.length) {
        body.innerHTML = `<tr><td colspan="5" class="fine">Nothing compressed yet.</td></tr>`;
        return;
      }
      body.innerHTML = state.history
        .map((row) => {
          const original = Number(row.original_bytes);
          const compressed = Number(row.compressed_bytes);
          const saved = original - compressed;
          const percent = original ? (saved / original) * 100 : 0;
          return `<tr>
            <td>${escapeHtml(row.file_name || "file")}</td>
            <td class="mono">${formatBytes(original)}</td>
            <td class="mono">${formatBytes(compressed)}</td>
            <td class="mono" data-grew="${saved < 0 ? "yes" : "no"}">${saved >= 0 ? "+" : "−"}${formatBytes(Math.abs(saved))} (${percent.toFixed(1)}%)</td>
            <td class="mono">${Number(row.encoding_ms ?? 0).toFixed(2)} ms</td>
          </tr>`;
        })
        .join("");
    } catch (err) {
      console.warn("[UniCompress] could not read the history:", err?.message);
      body.innerHTML = `<tr><td colspan="5" class="fine">The history could not be read.</td></tr>`;
    }
  }

  $("#ucHistoryRefresh")?.addEventListener("click", () => {
    loadHistory();
    loadCampusTotals();
  });

  // The complexity table is the same every time, so it is drawn once.
  const complexityEl = $("#ucComplexity");
  if (complexityEl) {
    complexityEl.innerHTML = COMPLEXITY.map(
      (row) => `<tr>
        <td><b>${escapeHtml(row.step)}</b><br/><span class="fine">${escapeHtml(row.detail)}</span></td>
        <td class="mono uc-complexity">${escapeHtml(row.complexity)}</td>
        <td class="mono">${escapeHtml(row.symbol)}</td>
      </tr>`
    ).join("");
  }

  loadHistory();
  loadCampusTotals();
}

/** Escape text that goes into the page. */
function escapeHtml(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

export { escapeHtml };
