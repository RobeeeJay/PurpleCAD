// The native weld (meshoptimizer, vendored): an imported STL stores three
// private vertices per triangle.  Welding must give the SAME surface -- every
// triangle at exactly the positions it had -- in far fewer vertices, and its
// edge counts must say truthfully whether the mesh is closed.
import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../init.js";
import { ops } from "../../occOps.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
const FACES = [
  [0, 2, 1],
  [0, 3, 2],
  [4, 5, 6],
  [4, 6, 7],
  [0, 1, 5],
  [0, 5, 4],
  [2, 3, 7],
  [2, 7, 6],
  [1, 2, 6],
  [1, 6, 5],
  [3, 0, 4],
  [3, 4, 7],
];
// A cube as STL stores it: 12 triangles, 36 vertices, no index buffer.
const soup = (faces = FACES) => {
  const positions = [];
  for (const f of faces) for (const v of f) positions.push(...CORNERS[v]);
  return { positions, indices: null };
};
// Each triangle as its three corner positions, in order.
const triangles = ({ positions, indices }) => {
  const I =
    indices ??
    positions
      .map((_, i) => i)
      .filter((i) => i % 3 === 0)
      .map((i) => i / 3);
  const out = [];
  for (let t = 0; t < I.length; t += 3)
    out.push(
      [0, 1, 2].map((k) => positions.slice(3 * I[t + k], 3 * I[t + k] + 3)),
    );
  return out;
};

describe("weldMesh", () => {
  it("welds a triangle soup to its shared corners", async () => {
    const r = await ops.weldMesh(soup());
    expect(r.verticesBefore).toBe(36);
    expect(r.verticesAfter).toBe(8);
    expect(r.indices).toHaveLength(36);
  });

  it("keeps every triangle exactly where it was", async () => {
    // Only bit-identical positions merge, so the surface is untouched --
    // same triangles, same order, same corner order (winding).
    const input = soup();
    const r = await ops.weldMesh(input);
    expect(triangles(r)).toEqual(triangles(input));
  });

  it("reports a closed mesh as closed", async () => {
    const r = await ops.weldMesh(soup());
    expect(r.openEdges).toBe(0);
    expect(r.nonManifoldEdges).toBe(0);
    expect(r.degenerateTriangles).toBe(0);
  });

  it("reports the hole in a box with no lid", async () => {
    // Drop the two top triangles: the four edges round the rim are used once.
    const r = await ops.weldMesh(
      soup(FACES.slice(0, 2).concat(FACES.slice(4))),
    );
    expect(r.openEdges).toBe(4);
  });

  it("does not merge points that are merely close", async () => {
    // A corner nudged by 1e-12 is a different point: welding must not move it.
    const input = soup();
    input.positions[0] += 1e-12;
    const r = await ops.weldMesh(input);
    expect(r.verticesAfter).toBe(9);
    expect(triangles(r)).toEqual(triangles(input));
  });

  it("counts a zero-area triangle apart instead of as an edge", async () => {
    const input = soup();
    input.positions.push(0, 0, 0, 0, 0, 0, 1, 0, 0); // repeats a corner
    const r = await ops.weldMesh(input);
    expect(r.degenerateTriangles).toBe(1);
    expect(r.openEdges).toBe(0);
  });
});
