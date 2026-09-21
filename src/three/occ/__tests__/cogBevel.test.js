// A chamfer or fillet on the top rim of an extruded cog, from
// test-files/bad-cog-fillet.pcad.  At 1 mm the bevel is wider than the tooth
// tips allow (about 1.4 mm across, so two 1 mm bevels overlap), and OCC's
// MakeChamfer / MakeFillet reported success with a solid whose faces overlapped
// and whose surface wasn't closed -- drawn, it was triangles spanning the air
// between the teeth.  A bevel that makes an invalid solid must be refused with
// the "try a smaller distance" error, and one that fits must stay a closed
// surface.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { ensureOcc } from "../init.js";
import { ops } from "../../occOps.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const doc = JSON.parse(
  fs.readFileSync("test-files/bad-cog-fillet.pcad", "utf8"),
);
const sketch = doc.history[1].instruction.item;
const bevel = doc.history[4].instruction.patches.regenerator;

const run = (segments, amount) =>
  ops.chamferOrFilletItem({
    source: bevel.source,
    subGeo: bevel.subGeo,
    amount,
    angleRad: null,
    segments,
    allItems: [sketch, bevel.source],
    printPrecision: 0.1,
  });

// Edges (after welding coincident vertices) not shared by exactly two
// triangles.  A closed solid's tessellation has none.
function unsharedEdges({ positions: P, indices: I }) {
  const key = (i) =>
    [0, 1, 2].map((k) => Math.round(P[i * 3 + k] * 1e5)).join(",");
  const edges = new Map();
  for (let t = 0; t < I.length; t += 3)
    for (let j = 0; j < 3; j++) {
      const a = key(I[t + j]),
        b = key(I[t + ((j + 1) % 3)]);
      if (a === b) continue;
      const e = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(e, (edges.get(e) || 0) + 1);
    }
  return [...edges.values()].filter((n) => n !== 2).length;
}

describe("bevelling the top of an extruded cog", () => {
  it("a 1 mm chamfer is refused rather than drawn broken", async () => {
    await expect(run(1, 0.1)).rejects.toThrow(/invalid solid/);
  }, 120000);

  it("a 1 mm fillet is refused rather than drawn broken", async () => {
    await expect(run(3, 0.1)).rejects.toThrow(/invalid solid/);
  }, 120000);

  it("a chamfer and a fillet that fit still work, as closed solids", async () => {
    for (const segments of [1, 3]) {
      const res = await run(segments, 0.02);
      expect(res?.geometryData, `segments ${segments}`).toBeTruthy();
      expect(unsharedEdges(res.geometryData), `segments ${segments}`).toBe(0);
    }
  }, 120000);
});
