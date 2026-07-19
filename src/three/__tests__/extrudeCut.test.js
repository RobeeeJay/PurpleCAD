// A multi-area extrude CUT (e.g. several holes at once) is ONE difference in
// ONE timeline entry, with the prism recipes embedded in an `extrudeCut`
// regenerator.  Previously each profile spawned its own prism item + its own
// async runCutExtrusion; those raced, each subtracting a single prism from the
// SAME original target, so the last writer won and only one hole survived — as
// N overlapping bodies, with 2N extra timeline entries.

import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { regenerateItemsForResolution } from "../regenerateItems.js";
import { useStore } from "../../store";
import { runCutExtrudes } from "../cameraControls/extrudeBoolean.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };

// A circular profile on the sketch plane, extruded along +z.
const circle = (cx, r = 0.5) => ({
  type: "sketchLoop",
  sketchId: 50,
  polygon2D: Array.from({ length: 32 }, (_, i) => {
    const a = (i / 32) * 2 * Math.PI;
    return { x: cx + Math.cos(a) * r, y: Math.sin(a) * r };
  }),
  holes: [],
  position: O,
  rotation: O,
  normalWorld: { x: 0, y: 0, z: 1 },
});

// A bore prism.  The negative startOffset is the user-reported case: the cut
// begins BELOW the sketch plane so it pierces the block from outside.
const bore = (id, cx) => ({
  id,
  name: `Extrude Cut ${id}`,
  type: "extrude",
  profile: circle(cx),
  depth: "40",
  startOffset: -2,
  isCut: true,
  position: O,
  rotation: O,
  scale: S,
});

// The block the bores are cut from: 6 x 6 x 2, spanning z -1..1.
const block = () => ({
  id: 1,
  name: "Cube 1",
  type: "cube",
  children: [],
  position: O,
  rotation: O,
  scale: { x: 3, y: 3, z: 1 },
});

// Does the result have a bore wall at (cx, 0)?  A cylindrical wall of radius r
// puts vertices all round that circle; a missing hole leaves none.  Checked at
// mid-thickness so the block's own outer faces can't satisfy it.
const hasBoreAt = (geometryData, cx, r = 0.5) => {
  const p = geometryData?.positions || [];
  let n = 0;
  for (let i = 0; i < p.length; i += 3) {
    const dx = p[i] - cx;
    const dy = p[i + 1];
    if (Math.abs(Math.hypot(dx, dy) - r) < 0.05 && Math.abs(p[i + 2]) <= 1.001)
      n += 1;
  }
  return n > 0;
};

describe("extrudeCut", () => {
  it("regenerates BOTH bores from the embedded prism recipes", async () => {
    const item = {
      id: 100,
      type: "csg",
      position: O,
      scale: S,
      rotation: O,
      geometryData: { positions: [], normals: null, indices: null },
      regenerator: {
        kind: "extrudeCut",
        extrudeDefs: [bore(101, -1.5), bore(102, 1.5)],
        inputIds: [1],
        originalCenter: O,
        regeneratedAt: 0.5,
      },
    };
    const out = await regenerateItemsForResolution([block(), item], 0.05);
    const cut = out.find((i) => i.id === 100);
    expect(cut.geometryData.positions.length).toBeGreaterThan(0);
    expect(cut.regenerator.regeneratedAt).toBe(0.05);
    expect(hasBoreAt(cut.geometryData, -1.5)).toBe(true);
    expect(hasBoreAt(cut.geometryData, 1.5)).toBe(true);
  });

  it("rebuilds as null rather than fusing the prisms when the target is gone", async () => {
    // Without the guard a targetless cut would union its bores — turning the
    // holes into solid pegs.
    const item = {
      id: 100,
      type: "csg",
      position: O,
      scale: S,
      rotation: O,
      geometryData: { positions: [0, 0, 0], normals: null, indices: null },
      regenerator: {
        kind: "extrudeCut",
        extrudeDefs: [bore(101, -1.5), bore(102, 1.5)],
        inputIds: [999],
        originalCenter: O,
        regeneratedAt: 0.5,
      },
    };
    const out = await regenerateItemsForResolution([item], 0.05);
    // Regeneration produced nothing, so the item keeps its previous mesh
    // instead of gaining bogus solid pegs.
    expect(out.find((i) => i.id === 100).geometryData.positions).toEqual([
      0, 0, 0,
    ]);
  });

  it("commits a two-hole cut as a SINGLE timeline entry", async () => {
    const store = useStore.getState();
    store.newDocument();
    useStore.getState().addItem(block());
    const before = useStore.getState().history.length;

    await runCutExtrudes([bore(101, -1.5), bore(102, 1.5)], 1, 100);

    const after = useStore.getState();
    // One entry for the cut itself, plus the consumeItems bookkeeping — but
    // never a per-hole prism entry (the old path added 2 prisms + 2 cuts).
    const added = after.history.length - before;
    expect(added).toBeLessThanOrEqual(2);
    const csgs = after.items.filter((i) => i.type === "csg");
    expect(csgs.length).toBe(1);
    expect(csgs[0].regenerator.kind).toBe("extrudeCut");
    expect(csgs[0].regenerator.extrudeDefs.length).toBe(2);
    // No leftover prism items, and the block was consumed by the cut.
    expect(after.items.filter((i) => i.type === "extrude").length).toBe(0);
    expect(after.items.find((i) => i.id === 1)?.visible).toBe(false);
    // Both bores really are in the committed mesh.
    expect(hasBoreAt(csgs[0].geometryData, -1.5)).toBe(true);
    expect(hasBoreAt(csgs[0].geometryData, 1.5)).toBe(true);
  });
});
