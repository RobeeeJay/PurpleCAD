// Welding imported meshes.  An STL stores three private vertices per triangle;
// welded (natively, meshoptimizer -- occClient.weldMesh) the same surface takes
// about a sixth of the vertices, and its edges show whether it is closed.  New
// imports are welded as they come in; meshes already in a document are welded
// when it loads.  Welded meshes are marked `flat` so they still draw with
// per-triangle normals (see sceneBuilder's csgDisplayGeometry).

import { useStore } from "../store";

// Stored as a soup: no index buffer, or one that uses each vertex once.  A
// welded mesh references every vertex several times.
function isSoup(g) {
  if (!g || g.flat || !Array.isArray(g.positions) || g.positions.length < 9)
    return false;
  if (!g.indices?.length) return true;
  return g.indices.length <= g.positions.length / 3;
}

async function weld(g) {
  const { weldMesh } = await import("./occClient.js");
  const r = await weldMesh({ positions: g.positions, indices: g.indices });
  if (!r || !(r.verticesAfter < r.verticesBefore)) return null;
  return {
    geometryData: {
      positions: r.positions,
      indices: r.indices,
      normals: null,
      flat: true,
    },
    report: {
      openEdges: r.openEdges,
      nonManifoldEdges: r.nonManifoldEdges,
      degenerateTriangles: r.degenerateTriangles,
    },
  };
}

// What to tell the user about an imported mesh that isn't a closed solid, or
// null when it is.  Booleans with an open mesh can leave holes in the result.
export function openMeshWarning(name, report) {
  if (!report?.openEdges) return null;
  return `${name} isn't a closed solid: it has ${report.openEdges} open edge${
    report.openEdges === 1 ? "" : "s"
  }. Booleans with it may leave holes.`;
}

// Weld a freshly imported mesh.  Falls back to the mesh as imported if the
// weld can't run, so an import never fails on account of it.
export async function weldForImport(geometryData) {
  if (!isSoup(geometryData)) return { geometryData, report: null };
  try {
    return (await weld(geometryData)) ?? { geometryData, report: null };
  } catch (err) {
    console.error("Weld on import failed:", err);
    return { geometryData, report: null };
  }
}

// Weld every imported mesh in the loaded document that is still a soup.
// Only a mesh the document still holds UNCHANGED is replaced, so an edit or a
// project switch while welding can't have a stale result written over it.
// One pass at a time.  The guard is cleared by the promise's own `finally`:
// clearing it inside the async body ran BEFORE the assignment when there was
// nothing to weld (no await, so the body finished synchronously), which left
// the guard set for good and made every later pass return that stale result.
let running = null;
export function weldExistingMeshes() {
  if (!running)
    running = weldAll().finally(() => {
      running = null;
    });
  return running;
}

async function weldAll() {
  const found = new Map();
  for (const entry of useStore.getState().history) {
    const inst = entry.instruction;
    const created =
      inst?.type === "create"
        ? [inst.item]
        : inst?.type === "createGroup"
          ? inst.items
          : [];
    for (const it of created ?? [])
      if (it?.type === "csg" && !it.regenerator && isSoup(it.geometryData))
        found.set(it.id, it.geometryData);
  }
  if (!found.size) return 0;
  const welded = new Map();
  for (const [id, g] of found) {
    try {
      const w = await weld(g);
      if (w) welded.set(id, w.geometryData);
    } catch (err) {
      console.error(`Weld of item ${id} failed:`, err);
    }
  }
  const still = new Map();
  for (const entry of useStore.getState().history) {
    const inst = entry.instruction;
    const created =
      inst?.type === "create"
        ? [inst.item]
        : inst?.type === "createGroup"
          ? inst.items
          : [];
    for (const it of created ?? [])
      if (welded.has(it?.id) && it.geometryData === found.get(it.id))
        still.set(it.id, welded.get(it.id));
  }
  if (still.size)
    useStore.getState().replaceCreatedGeometry(Object.fromEntries(still));
  return still.size;
}
