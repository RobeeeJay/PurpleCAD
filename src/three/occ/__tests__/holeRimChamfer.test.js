// A chamfer on the rim of a boss hole cut into MultiSystem2's base (an
// imported STL), from test-files/chamfer-fail.pcad.  It was refused at every
// size: the result had to pass BRepCheck with a closed mesh, which this body
// never did (3 open edges from degenerate triangles a Split left), so even a
// good bevel was refused as "doesn't fit".
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { ensureOcc } from "../init.js";
import { useStore } from "../../../store";
import { chamferOrFilletItem } from "../../occClient.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// A boss hole's rim -- each mesh edge shared by a hole-wall triangle and an
// up-facing one, in the body's local frame, as the pick records it.  The
// holes straddle a 2 mm step, so a rim runs on two levels; `lowerOnly` keeps
// the part on the lower one.
function rim(item, cx, { lowerOnly = false } = {}) {
  const P = item.geometryData.positions;
  const I = item.geometryData.indices;
  const o = item.position;
  const cz = -4.704;
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
    Math.abs(t.ny) < 0.2 && Math.hypot(t.c[0] - cx, t.c[2] - cz) < 0.23;
  const up = (t) => t.ny > 0.9;
  const edges = [];
  for (const { a, b, ts } of byEdge.values()) {
    if (ts.length !== 2) continue;
    const [t1, t2] = ts.map((i) => tri[i]);
    if (!((wall(t1) && up(t2)) || (wall(t2) && up(t1)))) continue;
    if (lowerOnly && a[1] + o.y > -0.5) continue;
    edges.push({ ax: a[0], ay: a[1], az: a[2], bx: b[0], by: b[1], bz: b[2] });
  }
  return edges;
}

const chamferRim = async (cx, part) => {
  const doc = JSON.parse(
    fs.readFileSync("test-files/chamfer-fail.pcad", "utf8"),
  );
  useStore.getState().loadDocument(doc);
  const items = useStore.getState().items;
  const cut = items.find((i) => i.id === 14);
  const edges = rim(cut, cx, part);
  let error = null;
  let result = null;
  try {
    result = await chamferOrFilletItem({
      source: cut,
      subGeo: { edges, faces: [] },
      amount: 0.02, // 0.2 mm
      angleRad: null,
      segments: 1,
      allItems: items,
      printPrecision: 0.05,
    });
  } catch (err) {
    error = err.message;
  }
  return { edges, error, tris: result?.geometryData?.indices?.length ?? 0 };
};

describe("a chamfer on a boss-hole rim in an imported base", () => {
  it("is built at 0.2 mm on the whole rim of the left hole", async () => {
    const { edges, error, tris } = await chamferRim(-11.692);
    expect(edges.length, "rim edges picked").toBeGreaterThan(10);
    expect(error, "the chamfer was refused").toBeNull();
    expect(tris).toBeGreaterThan(0);
  }, 300000);

  it("is built at 0.2 mm on the lower part of the right hole's rim", async () => {
    const { edges, error, tris } = await chamferRim(11.664, {
      lowerOnly: true,
    });
    expect(edges.length, "rim edges picked").toBeGreaterThan(3);
    expect(error, "the chamfer was refused").toBeNull();
    expect(tris).toBeGreaterThan(0);
  }, 300000);
});
