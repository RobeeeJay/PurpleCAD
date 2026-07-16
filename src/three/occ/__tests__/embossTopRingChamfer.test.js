// Regression: chamfering the outer top ring of a hollow cylinder that has an
// embossed/debossed letter on its side used to fail with "OCC rejected this
// combination of edges" — while the identical chamfer on the plain cylinder
// worked.  The deboss splits the outer wall into many faces, so several edges
// share the same adjacent-normal pair; enrichSubGeo tagged the selected ring
// edges with those normals and SelectSubGeoEdges then matched by normals ONLY,
// over-selecting a set MakeChamfer can't bevel together.  Endpoint-first
// matching (normals only as the resize fallback) pins the exact ring.
//
// Driven from the real failing project (fixtures/chamfer-fail-scene.pcad).

import { describe, it, expect, beforeAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ensureOcc } from "../init.js";

vi.mock("../../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({ variables: [] });
  return { useStore };
});

let buildItemShapeLocal, ops, replayUpTo, regenerateItemsForResolution;
beforeAll(async () => {
  await ensureOcc();
  ({ buildItemShapeLocal, ops } = await import("../../occOps.js"));
  ({ replayUpTo } = await import("../../../store/internals.js"));
  ({ regenerateItemsForResolution } = await import("../../regenerateItems.js"));
}, 60000);

const loadScene = () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const p = path.join(dir, "fixtures", "chamfer-fail-scene.pcad");
  return JSON.parse(fs.readFileSync(p, "utf8"));
};

// Outer top ring edges taken from a baked display mesh — exactly the selection
// the viewport hands the chamfer.
const outerTopRingFromMesh = (positions) => {
  let maxZ = -1e9;
  for (let i = 2; i < positions.length; i += 3)
    maxZ = Math.max(maxZ, positions[i]);
  let sx = 0,
    sy = 0,
    n = 0;
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i + 2] - maxZ) > 1e-3) continue;
    sx += positions[i];
    sy += positions[i + 1];
    n++;
  }
  const ccx = sx / n,
    ccy = sy / n;
  let maxR = 0;
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i + 2] - maxZ) > 1e-3) continue;
    maxR = Math.max(
      maxR,
      Math.hypot(positions[i] - ccx, positions[i + 1] - ccy),
    );
  }
  const seen = new Set();
  const uniq = [];
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i + 2] - maxZ) > 1e-3) continue;
    const rx = positions[i] - ccx,
      ry = positions[i + 1] - ccy;
    if (Math.abs(Math.hypot(rx, ry) - maxR) > 0.02) continue;
    const a = Math.atan2(ry, rx);
    const k = a.toFixed(4);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push({ x: positions[i], y: positions[i + 1], a });
  }
  uniq.sort((p, q) => p.a - q.a);
  const edges = [];
  for (let i = 0; i < uniq.length; i++) {
    const a = uniq[i],
      b = uniq[(i + 1) % uniq.length];
    edges.push({ ax: a.x, ay: a.y, az: maxZ, bx: b.x, by: b.y, bz: maxZ });
  }
  return edges;
};

describe("chamfer the top ring of an embossed hollow cylinder", () => {
  it("succeeds via the full app path (enrichSubGeo → chamferShape)", async () => {
    const data = loadScene();
    const items = replayUpTo(data.history, data.history.length - 1);
    const embossItem = items.find((i) => i.id === 2);
    expect(embossItem?.regenerator?.kind).toBe("emboss");

    // The display mesh was baked at this precision (regenerator.regeneratedAt);
    // the viewport builds the chamfer source at the same active precision.
    const pp = embossItem.regenerator.regeneratedAt ?? 0.1;
    const edges = outerTopRingFromMesh(embossItem.geometryData.positions);
    expect(edges.length).toBeGreaterThan(8);

    const result = await ops.chamferOrFilletItem({
      source: embossItem,
      subGeo: { edges, faces: [] },
      amount: 0.05,
      angleRad: null,
      segments: 1,
      allItems: items,
      printPrecision: pp,
    });
    expect(result).toBeTruthy();
    expect(result.geometryData.positions.length).toBeGreaterThan(0);
  });

  it("still selects the plain source's edge precisely (no over-selection)", () => {
    // Sanity: buildItemShapeLocal for the emboss rebuilds, and a single ring
    // edge picked by endpoints resolves without pulling in the whole wall.
    const data = loadScene();
    const items = replayUpTo(data.history, data.history.length - 1);
    const embossItem = items.find((i) => i.id === 2);
    const sid = buildItemShapeLocal(embossItem, items, 0.1);
    expect(sid).not.toBeNull();
  });

  it("regenerates at a finer precision (toggling high-res print mode)", async () => {
    // The chamfer was created at the bake precision; toggling print mode
    // rebuilds the body at a FINER density, moving every stored endpoint.  The
    // proximity match must still find the ring so the chamfer isn't dropped
    // (it used to fail to re-match and keep the stale coarse geometry).
    const data = loadScene();
    const items = replayUpTo(data.history, data.history.length - 1);
    const embossItem = items.find((i) => i.id === 2);
    const pp = embossItem.regenerator.regeneratedAt ?? 0.1;

    const created = await ops.chamferOrFilletItem({
      source: embossItem,
      subGeo: {
        edges: outerTopRingFromMesh(embossItem.geometryData.positions),
        faces: [],
      },
      amount: 0.05,
      angleRad: null,
      segments: 1,
      allItems: items,
      printPrecision: pp,
    });
    expect(created).toBeTruthy();

    // Re-run the committed chamfer at a much finer precision.
    const chamferItem = {
      id: 2,
      type: "csg",
      position: created.position,
      geometryData: created.geometryData,
      regenerator: {
        kind: "chamfer",
        source: embossItem,
        subGeo: created.resolvedSubGeo,
        amount: 0.05,
        segments: 1,
        centerOffset: created.centerOffset,
        regeneratedAt: "dirty",
      },
    };
    const out = await regenerateItemsForResolution(
      [items[0], items[1], chamferItem],
      0.02,
    );
    const regen = out.find((i) => i.id === 2);
    expect(regen.regenerator.regenFailed).toBeFalsy();
    expect(regen.regenerator.regeneratedAt).toBe(0.02);
  });
});
