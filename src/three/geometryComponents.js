// Splits a triangle-mesh geometryData ({ positions, normals?, indices? }) into
// its connected components — the geometrically disconnected solids that share
// no welded vertices.  A union of non-touching parts, or a difference that
// severs a body into separate lumps, yields multiple components; a single
// welded solid yields one.  Used by the Split toolbar action.

// Vertices that coincide in space but are distinct in the buffer (boolean
// results commonly duplicate seam vertices) must be welded first, otherwise
// abutting triangles look disconnected.  Quantize to a tolerance so
// floating-point jitter doesn't split a single weld point.
const WELD_DECIMALS = 5;

const weldKey = (x, y, z) =>
  `${x.toFixed(WELD_DECIMALS)},${y.toFixed(WELD_DECIMALS)},${z.toFixed(WELD_DECIMALS)}`;

const find = (parent, i) => {
  let root = i;
  while (parent[root] !== root) root = parent[root];
  while (parent[i] !== root) {
    const next = parent[i];
    parent[i] = root;
    i = next;
  }
  return root;
};

const unite = (parent, a, b) => {
  const ra = find(parent, a);
  const rb = find(parent, b);
  if (ra !== rb) parent[ra] = rb;
};

// Returns an array of geometryData objects, one per connected component.
// Single-component (or empty) geometry returns a one-element array.
export function splitGeometryComponents(geometryData) {
  const positions = geometryData.positions || [];
  const normals = geometryData.normals || null;
  const vertexCount = positions.length / 3;
  if (vertexCount === 0) return [geometryData];

  const indices =
    geometryData.indices && geometryData.indices.length
      ? geometryData.indices
      : Array.from({ length: vertexCount }, (_, i) => i);
  const triCount = indices.length / 3;

  // Map each buffer vertex to its welded representative, then union-find the
  // welded reps that share a triangle.
  const weldOf = new Int32Array(vertexCount);
  const keyToWeld = new Map();
  for (let v = 0; v < vertexCount; v++) {
    const key = weldKey(
      positions[v * 3],
      positions[v * 3 + 1],
      positions[v * 3 + 2],
    );
    let w = keyToWeld.get(key);
    if (w === undefined) {
      w = keyToWeld.size;
      keyToWeld.set(key, w);
    }
    weldOf[v] = w;
  }

  const parent = new Int32Array(keyToWeld.size);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  for (let t = 0; t < triCount; t++) {
    const a = weldOf[indices[t * 3]];
    const b = weldOf[indices[t * 3 + 1]];
    const c = weldOf[indices[t * 3 + 2]];
    unite(parent, a, b);
    unite(parent, b, c);
  }

  // Bucket triangles by their component root.
  const triByRoot = new Map();
  for (let t = 0; t < triCount; t++) {
    const root = find(parent, weldOf[indices[t * 3]]);
    let list = triByRoot.get(root);
    if (!list) {
      list = [];
      triByRoot.set(root, list);
    }
    list.push(t);
  }

  if (triByRoot.size <= 1) return [geometryData];

  // Rebuild a compact buffer per component, remapping only the vertices it
  // references so each part is self-contained.
  const components = [];
  for (const tris of triByRoot.values()) {
    const remap = new Map();
    const outPos = [];
    const outNorm = normals ? [] : null;
    const outIdx = [];
    for (const t of tris) {
      for (let k = 0; k < 3; k++) {
        const orig = indices[t * 3 + k];
        let ni = remap.get(orig);
        if (ni === undefined) {
          ni = remap.size;
          remap.set(orig, ni);
          outPos.push(
            positions[orig * 3],
            positions[orig * 3 + 1],
            positions[orig * 3 + 2],
          );
          if (outNorm)
            outNorm.push(
              normals[orig * 3],
              normals[orig * 3 + 1],
              normals[orig * 3 + 2],
            );
        }
        outIdx.push(ni);
      }
    }
    const comp = { positions: outPos, indices: outIdx };
    if (outNorm) comp.normals = outNorm;
    components.push(comp);
  }
  return components;
}

// Cheap-ish count for enabling the Split button without building buffers.
export function countGeometryComponents(geometryData) {
  if (!geometryData) return 0;
  const positions = geometryData.positions || [];
  const vertexCount = positions.length / 3;
  if (vertexCount === 0) return 0;

  const indices =
    geometryData.indices && geometryData.indices.length
      ? geometryData.indices
      : Array.from({ length: vertexCount }, (_, i) => i);
  const triCount = indices.length / 3;

  const keyToWeld = new Map();
  const weldOf = new Int32Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    const key = weldKey(
      positions[v * 3],
      positions[v * 3 + 1],
      positions[v * 3 + 2],
    );
    let w = keyToWeld.get(key);
    if (w === undefined) {
      w = keyToWeld.size;
      keyToWeld.set(key, w);
    }
    weldOf[v] = w;
  }

  const parent = new Int32Array(keyToWeld.size);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  for (let t = 0; t < triCount; t++) {
    const a = weldOf[indices[t * 3]];
    const b = weldOf[indices[t * 3 + 1]];
    const c = weldOf[indices[t * 3 + 2]];
    unite(parent, a, b);
    unite(parent, b, c);
  }

  const roots = new Set();
  for (let t = 0; t < triCount; t++) {
    roots.add(find(parent, weldOf[indices[t * 3]]));
  }
  return roots.size;
}
