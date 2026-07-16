// Compact persistence for baked meshes.  geometryData serialised as raw JSON
// number arrays is ruinous: a 200k-triangle displacement mesh is ~100 MB of
// float TEXT, documents ballooned past 300 MB, and every save re-stringified
// the lot — the transient strings alone OOM'd the renderer.  Packed form is
// base64 over Float32/Uint32 (~10× smaller, cheap to encode); the in-memory
// representation stays plain arrays, packing happens only at the persistence
// boundaries (SQLite timeline save/load, .pcad save/load).

const PACK_THRESHOLD = 1024; // small meshes stay readable JSON

const toB64 = (bytes) => {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK)
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return btoa(out);
};

const fromB64 = (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

const isGeometryData = (v) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  (Array.isArray(v.positions) || v.__packedGeometry === 1);

// Pack/unpack results are memoised by OBJECT IDENTITY: the history walker is
// structurally shared, so an unchanged entry presents the same geometryData
// reference on every save — without the memo, every mouseup that appends a
// transform step re-base64'd every dense mesh in the document (seconds of
// main-thread freeze on multi-texture documents).
const packMemo = new WeakMap();
const unpackMemo = new WeakMap();

export function packGeometryData(g) {
  if (!g || g.__packedGeometry === 1) return g;
  if (!Array.isArray(g.positions) || g.positions.length < PACK_THRESHOLD)
    return g;
  const hit = packMemo.get(g);
  if (hit) return hit;
  const out = {
    __packedGeometry: 1,
    p: toB64(new Uint8Array(new Float32Array(g.positions).buffer)),
  };
  if (g.indices?.length)
    out.i = toB64(new Uint8Array(new Uint32Array(g.indices).buffer));
  if (g.normals?.length)
    out.n = toB64(new Uint8Array(new Float32Array(g.normals).buffer));
  packMemo.set(g, out);
  // A later unpack of this exact packed object returns the ORIGINAL arrays —
  // free, and identity-stable across a save/load cycle in the same session.
  unpackMemo.set(out, g);
  return out;
}

export function unpackGeometryData(g) {
  if (!g || g.__packedGeometry !== 1) return g;
  const hit = unpackMemo.get(g);
  if (hit) return hit;
  const out = { positions: Array.from(new Float32Array(fromB64(g.p).buffer)) };
  out.indices = g.i
    ? Array.from(new Uint32Array(fromB64(g.i).buffer))
    : g.indices || null;
  out.normals = g.n ? Array.from(new Float32Array(fromB64(g.n).buffer)) : null;
  unpackMemo.set(g, out);
  packMemo.set(out, g);
  return out;
}

// Deep-walk any timeline/history structure and transform every geometryData
// field (entry patches, created items, nested regenerator sources).  Returns
// a structurally-shared copy — untouched subtrees keep their identity, so
// packing before a save doesn't clone the whole history.
function walk(node, transform, seen) {
  if (!node || typeof node !== "object") return node;
  if (seen.has(node)) return seen.get(node);
  if (Array.isArray(node)) {
    let out = node;
    for (let i = 0; i < node.length; i++) {
      const v = walk(node[i], transform, seen);
      if (v !== node[i]) {
        if (out === node) out = node.slice();
        out[i] = v;
      }
    }
    seen.set(node, out);
    return out;
  }
  let out = node;
  for (const k of Object.keys(node)) {
    let v = node[k];
    if (k === "geometryData" && isGeometryData(v)) v = transform(v);
    else v = walk(v, transform, seen);
    if (v !== node[k]) {
      if (out === node) out = { ...node };
      out[k] = v;
    }
  }
  seen.set(node, out);
  return out;
}

export const packHistory = (history) =>
  walk(history, packGeometryData, new Map());
export const unpackHistory = (history) =>
  walk(history, unpackGeometryData, new Map());
