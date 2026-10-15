// Sewing a mesh into a solid must keep every face, facing the way it did.
// A boolean on an imported mesh must not lose any of its faces -- nor may the
// recalc's sew of a step's baked mesh, which feeds the next op.  The import
// sew merges coplanar triangles into larger faces, and on MultiSystem2's base
// STL one merged face could not be meshed: the mesher skipped it, so the
// body -- and every Split piece and cut built on it -- showed a hole in its
// top.  The sew now keeps the unmerged faces when merging opens the mesh.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { ensureOcc } from "../init.js";
import { performCsg } from "../../occClient.js";
import { ops } from "../../occOps.js";
import { unpackGeometryData } from "../../../store/geometryPack.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// Edges (welded by position) used by exactly one triangle: the outline of any
// hole in the mesh.
function openEdges({ positions: P, indices: I }) {
  const key = (k) =>
    `${P[k * 3].toFixed(4)},${P[k * 3 + 1].toFixed(4)},${P[k * 3 + 2].toFixed(4)}`;
  const uses = new Map();
  for (let t = 0; t < I.length; t += 3)
    for (let e = 0; e < 3; e++) {
      const a = key(I[t + e]);
      const b = key(I[t + ((e + 1) % 3)]);
      if (a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      uses.set(k, (uses.get(k) || 0) + 1);
    }
  return [...uses].filter(([, n]) => n === 1).map(([k]) => k);
}

describe("a boolean on an imported STL", () => {
  it("keeps every face of MultiSystem2's base", async () => {
    const doc = JSON.parse(
      fs.readFileSync("test-files/multisystem2.pcad", "utf8"),
    );
    const stl = doc.history.find((e) => e.id === 1).instruction.item;
    const base = { ...stl, geometryData: unpackGeometryData(stl.geometryData) };
    // A tool far from the part: the result is the base alone, rebuilt.
    const far = {
      id: 999,
      name: "Far",
      type: "cube",
      children: [],
      position: { x: 100, y: 100, z: 100 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const result = await performCsg({
      selectedItems: [base, far],
      operation: "difference",
      printPrecision: 0.1,
      allItems: [base, far],
    });
    const open = openEdges(result.geometryData);
    expect(open, `open edges: ${open.slice(0, 5).join("  ")}`).toEqual([]);
  }, 120000);

  it("keeps every face when the recalc sews its mesh for the next step", () => {
    const doc = JSON.parse(
      fs.readFileSync("test-files/multisystem2.pcad", "utf8"),
    );
    const g = unpackGeometryData(
      doc.history.find((e) => e.id === 1).instruction.item.geometryData,
    );
    const { shapeId } = ops.solidFromMesh(g);
    try {
      const { geometryData } = ops.tessellateItem({
        sourceShapeId: shapeId,
        printPrecision: 0.1,
      });
      const open = openEdges(geometryData);
      expect(open, `open edges: ${open.slice(0, 5).join("  ")}`).toEqual([]);
    } finally {
      ops.releaseShape({ id: shapeId });
    }
  }, 120000);
});

// Is the point inside the triangle soup?  Ray parity along `d`.
function inside(P, I, q, d) {
  let hits = 0;
  for (let t = 0; t < I.length; t += 3) {
    const v = [0, 1, 2].map((k) => [
      P[I[t + k] * 3],
      P[I[t + k] * 3 + 1],
      P[I[t + k] * 3 + 2],
    ]);
    const e1 = v[1].map((x, k) => x - v[0][k]);
    const e2 = v[2].map((x, k) => x - v[0][k]);
    const h = [
      d[1] * e2[2] - d[2] * e2[1],
      d[2] * e2[0] - d[0] * e2[2],
      d[0] * e2[1] - d[1] * e2[0],
    ];
    const a = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
    if (Math.abs(a) < 1e-14) continue;
    const s = q.map((x, k) => x - v[0][k]);
    const u = (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]) / a;
    if (u < 0 || u > 1) continue;
    const qv = [
      s[1] * e1[2] - s[2] * e1[1],
      s[2] * e1[0] - s[0] * e1[2],
      s[0] * e1[1] - s[1] * e1[0],
    ];
    const w = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) / a;
    if (w < 0 || u + w > 1) continue;
    if ((e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / a > 1e-9) hits++;
  }
  return hits % 2 === 1;
}

describe("sewing a Split piece of MultiSystem2's base", () => {
  // Beside the right boss the piece's surface pinches -- four triangles on
  // one edge -- and sewing's own orientation pass carried the wall there
  // inside-out, so every boolean on the piece drew it from behind: a face
  // that vanished when the boss holes were cut.  The mesh itself is wound
  // right, and the sew now keeps each face the way its triangle faces.
  it("keeps the wall beside the right boss facing out through a cut", async () => {
    const doc = JSON.parse(
      fs.readFileSync("test-files/multisystem2.pcad", "utf8"),
    );
    const stored = doc.history
      .find((e) => e.id === 2)
      .instruction.items.find((i) => i.id === 3);
    const piece = {
      ...stored,
      geometryData: unpackGeometryData(stored.geometryData),
    };
    // A 2 mm block through the right boss, as the boss hole was cut.
    const block = {
      id: 998,
      name: "Block",
      type: "cube",
      children: [],
      position: { x: 11.68, y: -0.5, z: -4.7 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 0.1, y: 0.1, z: 0.1 },
    };
    const result = await performCsg({
      selectedItems: [piece, block],
      operation: "difference",
      printPrecision: 0.1,
      allItems: [piece, block],
    });
    const P = Array.from(result.geometryData.positions, (x, i) =>
      i % 3 === 0
        ? x + result.position.x
        : i % 3 === 2
          ? x + result.position.z
          : x,
    );
    const I = result.geometryData.indices;
    // A boolean against an inside-out solid returns nothing at all.
    expect(I.length / 3, "triangles in the cut body").toBeGreaterThan(10000);
    const oy = result.position.y;
    const dirs = [
      [0.48, -0.29, 0.83],
      [-0.61, 0.72, 0.33],
      [0.2, 0.44, -0.87],
    ];
    const inward = [];
    let checked = 0;
    for (let t = 0; t < I.length; t += 3) {
      const v = [0, 1, 2].map((k) => [
        P[I[t + k] * 3],
        P[I[t + k] * 3 + 1],
        P[I[t + k] * 3 + 2],
      ]);
      const c = [0, 1, 2].map((k) => (v[0][k] + v[1][k] + v[2][k]) / 3);
      // The wall: vertical faces in the patch around x 11.7, z -5.6.
      if (c[0] < 11.68 || c[0] > 11.8 || c[2] < -5.77 || c[2] > -5.5) continue;
      const e1 = v[1].map((x, k) => x - v[0][k]);
      const e2 = v[2].map((x, k) => x - v[0][k]);
      const n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const len = Math.hypot(...n);
      if (len < 2e-4 || Math.abs(n[1] / len) > 0.3) continue;
      checked++;
      const q = c.map((x, k) => x + (n[k] / len) * 2e-3);
      const votes = dirs.filter((d) => inside(P, I, q, d)).length;
      if (votes >= 2)
        inward.push(
          `(${c[0].toFixed(3)}, ${(c[1] + oy).toFixed(3)}, ${c[2].toFixed(3)})`,
        );
    }
    expect(checked, "wall triangles found to check").toBeGreaterThan(5);
    expect(inward, `inward-facing wall triangles at ${inward}`).toEqual([]);
  }, 120000);
});
