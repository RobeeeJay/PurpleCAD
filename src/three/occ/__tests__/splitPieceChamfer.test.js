// A Split piece must take a chamfer its source took.  In
// test-files/chamfer-fail.pcad the inner top rim of the extruded rings bevels
// at their own step, and failed at once on the piece a Split made of them: a
// later op rebuilt the piece by sewing its displayed mesh -- float32 triangles
// whose "flat" faces weren't quite -- instead of the source's true faces.  A
// piece is now re-cut from its source by its recipe.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { ensureOcc } from "../init.js";
import { useStore } from "../../../store";
import { recalculateTimeline } from "../../regenerateOrchestrator.js";
import { chamferOrFilletItem } from "../../occClient.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// The ring's inner top rim around the right boss axis: each mesh edge shared
// by a wall triangle within 2.5 mm of the axis and an up-facing one, at the
// highest such level -- in the body's local frame, as a pick records it.
function innerTopRim(item) {
  const [cx, cz] = [11.664, -4.704];
  const P = item.geometryData.positions;
  const I = item.geometryData.indices;
  const o = item.position;
  const tri = [];
  for (let t = 0; t < I.length; t += 3) {
    const v = [0, 1, 2].map((k) => [
      P[I[t + k] * 3],
      P[I[t + k] * 3 + 1],
      P[I[t + k] * 3 + 2],
    ]);
    const e1 = v[1].map((x, k) => x - v[0][k]);
    const e2 = v[2].map((x, k) => x - v[0][k]);
    const n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const len = Math.hypot(...n) || 1;
    const c = [0, 1, 2].map(
      (k) => (v[0][k] + v[1][k] + v[2][k]) / 3 + [o.x, o.y, o.z][k],
    );
    tri.push({ v, ny: n[1] / len, c });
  }
  const key = (p) => p.map((x) => x.toFixed(5)).join();
  const byEdge = new Map();
  tri.forEach((t, i) => {
    for (let e = 0; e < 3; e++) {
      const a = t.v[e];
      const b = t.v[(e + 1) % 3];
      const k = [key(a), key(b)].sort().join("|");
      if (!byEdge.has(k)) byEdge.set(k, { a, b, ts: [] });
      byEdge.get(k).ts.push(i);
    }
  });
  const wall = (t) =>
    Math.abs(t.ny) < 0.2 && Math.hypot(t.c[0] - cx, t.c[2] - cz) < 0.25;
  const up = (t) => t.ny > 0.9;
  const rim = [];
  for (const { a, b, ts } of byEdge.values()) {
    if (ts.length !== 2) continue;
    const [t1, t2] = ts.map((i) => tri[i]);
    if ((wall(t1) && up(t2)) || (wall(t2) && up(t1)))
      rim.push({ a, b, y: a[1] + o.y });
  }
  const top = Math.max(...rim.map((e) => e.y));
  return rim
    .filter((e) => Math.abs(e.y - top) < 0.01)
    .map(({ a, b }) => ({
      ax: a[0],
      ay: a[1],
      az: a[2],
      bx: b[0],
      by: b[1],
      bz: b[2],
    }));
}

const chamferAt = async (entryId, itemId) => {
  useStore.getState().restoreToHistory(entryId);
  await recalculateTimeline();
  const items = useStore.getState().items;
  const body = items.find((i) => i.id === itemId);
  const edges = innerTopRim(body);
  // One per side of the ring's polygon: 10 at 0.1 mm, 14 at 0.05 mm.
  expect(edges.length, "rim edges picked").toBeGreaterThanOrEqual(8);
  try {
    const r = await chamferOrFilletItem({
      source: body,
      subGeo: { edges, faces: [] },
      amount: 0.02, // 0.2 mm
      angleRad: null,
      segments: 1,
      allItems: items,
      printPrecision: 0.05,
    });
    return r ? null : "no result";
  } catch (err) {
    return err.message;
  }
};

describe("a chamfer on a Split piece", () => {
  it("bevels the rim its unsplit source bevelled", async () => {
    const doc = JSON.parse(
      fs.readFileSync("test-files/chamfer-fail.pcad", "utf8"),
    );
    useStore.getState().loadDocument(doc);
    await recalculateTimeline();
    expect(await chamferAt(5, 5), "Extruded 5, before the Split").toBeNull();
    expect(await chamferAt(6, 7), "its piece, after the Split").toBeNull();
    // Four Splits on: the piece left at the end of the chain.
    expect(await chamferAt(16, 13), "the last piece").toBeNull();
  }, 600000);
});
