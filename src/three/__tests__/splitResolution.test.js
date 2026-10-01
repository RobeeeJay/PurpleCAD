// A Split's pieces must follow a resolution change like any other body.  They
// used to be stored as finished meshes with no recipe, so the recalc had
// nothing to rebuild them from: in MultiSystem2 the extruded circles, split
// four times, stayed at the resolution they were cut at while everything
// else went fine.  Pieces now carry a re-cut recipe (source, plane, side);
// documents saved before get one recovered from the pieces at load.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";
import { unpackGeometryData } from "../../store/geometryPack.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// World bounding box of an item's mesh, as [min, max] per axis.
function worldBox(item) {
  const g = unpackGeometryData(item.geometryData);
  const P = g.positions;
  const o = item.position;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = P[i + k] + [o.x, o.y, o.z][k];
      lo[k] = Math.min(lo[k], v);
      hi[k] = Math.max(hi[k], v);
    }
  return [lo, hi];
}
const tris = (item) => unpackGeometryData(item.geometryData).indices.length / 3;

describe("the pieces of a Split", () => {
  it("are re-cut at a finer resolution, and still in the same place", async () => {
    const doc = JSON.parse(
      fs.readFileSync("test-files/multisystem2.pcad", "utf8"),
    );
    const saved = new Map();
    for (const e of doc.history)
      if (e.instruction.type === "createGroup")
        for (const it of e.instruction.items) saved.set(it.id, it);

    useStore.getState().loadDocument(doc);
    await recalculateTimeline();
    // Re-cut once at the document's resolution: each piece where it was.
    // Some pieces were deleted later in the timeline; check the rest.
    const present = [...saved.keys()].filter((id) =>
      useStore.getState().items.some((i) => i.id === id),
    );
    expect(present).toEqual(expect.arrayContaining([3, 7, 9, 11, 13]));
    const coarse = new Map();
    for (const id of present) {
      const before = saved.get(id);
      const item = useStore.getState().items.find((i) => i.id === id);
      expect(item.regenerator?.kind, `piece ${id} has a recipe`).toBe("split");
      const [lo0, hi0] = worldBox(before);
      const [lo1, hi1] = worldBox(item);
      for (let k = 0; k < 3; k++) {
        expect(
          Math.abs(lo1[k] - lo0[k]) + Math.abs(hi1[k] - hi0[k]),
          `piece ${id} axis ${k}: saved ${lo0[k]}..${hi0[k]}, re-cut ${lo1[k]}..${hi1[k]}`,
        ).toBeLessThan(0.01);
      }
      coarse.set(id, tris(item));
    }

    useStore.setState({ printPrecisionMm: 0.01 });
    useStore.getState().toggleCurveResolution();
    await recalculateTimeline();
    // The circles' pieces (7, 9, 11, 13 carry the curved walls) gain triangles.
    for (const id of [7, 9, 11, 13]) {
      const item = useStore.getState().items.find((i) => i.id === id);
      expect(
        tris(item),
        `piece ${id}: ${coarse.get(id)} triangles before, ${tris(item)} after`,
      ).toBeGreaterThan(coarse.get(id) * 2);
    }
  }, 600000);
});
