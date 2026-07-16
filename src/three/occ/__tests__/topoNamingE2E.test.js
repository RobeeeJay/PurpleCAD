// Phase B end-to-end (through occOps, not raw occ): a chamfer captures its
// face's persistent name at commit (enrichSubGeo) and, after the extrude's
// DEPTH changes so the stored hit point no longer lies on the top face, the
// name still re-selects the top — where coordinate matching would pick a
// different face.

import { describe, it, expect, beforeAll, vi } from "vitest";
import { ensureOcc } from "../init.js";

vi.mock("../../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({ variables: [] });
  return { useStore };
});

let ops;
beforeAll(async () => {
  await ensureOcc();
  ({ ops } = await import("../../occOps.js"));
}, 60000);

const src = (depth) => ({
  id: 1,
  type: "extrude",
  depth,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  profile: {
    sketchId: null,
    profileCentroid: { x: 0, y: 0 },
    polygon2D: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
    holes: [],
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    normalWorld: { x: 0, y: 0, z: 1 },
  },
});

const sig = (g) => {
  let s = 0;
  for (let i = 0; i < g.positions.length; i++) s += g.positions[i];
  return `${g.positions.length}:${s.toFixed(3)}`;
};
const args = {
  amount: 0.1,
  angleRad: null,
  segments: 1,
  allItems: [],
  printPrecision: 0.05,
};

describe("chamfer name capture + resolve survives a depth edit (occOps)", () => {
  it("captures the top face name and re-selects it after the top moves", async () => {
    // Commit on depth 2: hit point on the top cap (z=2).
    const commit = await ops.chamferOrFilletItem({
      source: src(2),
      subGeo: {
        edges: [],
        faces: [{ nx: 0, ny: 0, nz: 1, cx: 0, cy: 0, cz: 2 }],
      },
      ...args,
    });
    const named = commit.resolvedSubGeo.faces[0].name;
    expect(named).toBe("top"); // captured at commit — JS threading works

    // Reference: chamfer the depth-4 top the normal way.
    const ref = await ops.chamferOrFilletItem({
      source: src(4),
      subGeo: {
        edges: [],
        faces: [{ nx: 0, ny: 0, nz: 1, cx: 0, cy: 0, cz: 4 }],
      },
      ...args,
    });

    // Name ONLY — no normal, no coordinates.  Resolves the top through occOps
    // and matches the reference chamfer exactly.
    const byName = await ops.chamferOrFilletItem({
      source: src(4),
      subGeo: { edges: [], faces: [{ name: "top" }] },
      ...args,
    });
    expect(byName).toBeTruthy();
    // Name alone drove the selection through the full occOps stack, matching the
    // coordinate-based reference chamfer exactly.
    expect(sig(byName.geometryData)).toBe(sig(ref.geometryData));
  });
});
