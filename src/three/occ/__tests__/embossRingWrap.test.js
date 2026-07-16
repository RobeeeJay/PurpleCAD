// Conform emboss/deboss of wrapped TEXT on a closed ring wall — the
// bad-emboss-test-scene regression.  The wall's cross-section is a CLOSED loop;
// buildDevelopableConformMesh must WRAP the arc-length parameter around its seam
// (curve end → start).  When it clamped instead, text anchored near the seam
// (wherever the user clicked) was squashed into degenerate self-intersecting
// slivers: letters missing/garbled and a boolean that ran for minutes.

import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import { createRequire } from "module";

vi.mock("../../../store", () => {
  const useStore = () => null;
  useStore.getState = () => ({ variables: [] });
  return { useStore };
});

const req = createRequire(import.meta.url);
const occ = req("../../../../native/occ-addon/build/Release/occ_addon.node");

// Real scene: thin extruded ring (r≈2.24–2.49, depth 50 mm) + "1234567890" in
// Impact — ten glyphs, several with holes.
const doc = JSON.parse(
  fs.readFileSync("test-files/bad-emboss-test-scene.pcad", "utf8"),
);
const sketch = doc.history[1].instruction.item;
const extrude = { ...doc.history[2].instruction.item, depth: 5 };

async function buildScene() {
  const { groupLoopsWithHoles } =
    await import("../../sceneObjects/closedLoops.js");
  const text = sketch.shapes.find((s) => s.type === "text");
  const loops = text.contours.map((c) =>
    c.map((p) => ({ x: p.x + text.x, y: p.y + text.y })),
  );
  const flat = [];
  const collect = (e) => {
    flat.push(e);
    e.entries?.forEach(collect);
  };
  groupLoopsWithHoles(loops).forEach(collect);
  const profiles = flat.map((g) => ({
    polygon2D: g.polygon,
    holes: (g.entries ?? []).map((e) => e.polygon),
    rotation: { x: 0, y: 0, z: 0 },
    position: { x: 0, y: 0, z: 0 },
  }));

  // Developable wall data in the body's LOCAL frame (circle in XY, extruded +Z)
  // — the frame reviveDevelopable rebuilds from the live wall polygon.
  const poly = extrude.profile.polygon2D;
  const curve = poly.map((p) => ({ u: p.x + 1, v: p.y - 2 })); // centre (-1,2)
  const arc = [0];
  for (let i = 1; i < curve.length; i++)
    arc.push(
      arc[i - 1] +
        Math.hypot(curve[i].u - curve[i - 1].u, curve[i].v - curve[i - 1].v),
    );
  const norms = curve.map((c) => {
    const l = Math.hypot(c.u, c.v) || 1;
    return { u: c.u / l, v: c.v / l };
  });
  const R = Math.hypot(curve[0].u, curve[0].v);
  const dev = {
    axis: [0, 0, 1],
    e1: [1, 0, 0],
    e2: [0, 1, 0],
    curve,
    arc,
    norms,
    aMin: 0,
    aMax: 5,
  };
  return { profiles, dev, R };
}

describe("chamfer/fillet on the ring's CLOSED top rims", () => {
  it("both ops handle full closed-loop edge rings (no seam issue)", async () => {
    // The emboss wrap had a closed-loop seam bug; verify the chamfer/fillet
    // path — which selects discrete OCC edges, no arc-length parameterisation —
    // handles a fully closed rim (inner + outer circles of the annulus top).
    const { ops, buildItemShapeLocal } = await import("../../occOps.js");
    const req2 = createRequire(import.meta.url);
    const occ2 = req2(
      "../../../../native/occ-addon/build/Release/occ_addon.node",
    );
    const bodyId = buildItemShapeLocal(extrude, [sketch, extrude], 0.1);
    const t = occ2.tessellate(bodyId, 0.1);
    occ2.releaseShape(bodyId);
    // Collect the OUTER top rim as chained edge segments (z = max).
    let maxZ = -1e9;
    for (let i = 0; i < t.positions.length; i += 3)
      maxZ = Math.max(maxZ, t.positions[i + 2]);
    let maxR = 0;
    for (let i = 0; i < t.positions.length; i += 3) {
      if (Math.abs(t.positions[i + 2] - maxZ) > 1e-3) continue;
      maxR = Math.max(maxR, Math.hypot(t.positions[i], t.positions[i + 1]));
    }
    const seen = new Set();
    const rim = [];
    for (let i = 0; i < t.positions.length; i += 3) {
      if (Math.abs(t.positions[i + 2] - maxZ) > 1e-3) continue;
      if (
        Math.abs(Math.hypot(t.positions[i], t.positions[i + 1]) - maxR) > 0.02
      )
        continue;
      const a = Math.atan2(t.positions[i + 1], t.positions[i]).toFixed(4);
      if (seen.has(a)) continue;
      seen.add(a);
      rim.push({ x: t.positions[i], y: t.positions[i + 1], a: Number(a) });
    }
    rim.sort((p, q) => p.a - q.a);
    const edges = rim.map((p, i) => {
      const q = rim[(i + 1) % rim.length];
      return { ax: p.x, ay: p.y, az: maxZ, bx: q.x, by: q.y, bz: maxZ };
    });
    expect(edges.length).toBeGreaterThan(8);
    for (const segments of [1, 3]) {
      const res = await ops.chamferOrFilletItem({
        source: extrude,
        subGeo: { edges, faces: [] },
        amount: 0.05,
        angleRad: null,
        segments,
        allItems: [sketch, extrude],
        printPrecision: 0.1,
      });
      expect(res).toBeTruthy();
      expect(res.geometryData.positions.length).toBeGreaterThan(0);
    }
  }, 120000);
});

describe("conform text emboss on a closed ring wall", () => {
  it("emboss + deboss survive a seam-adjacent anchor (wrap, not clamp)", async () => {
    const { buildEmbossStamp } = await import("../../embossGeometry.js");
    const { ops, buildItemShapeLocal } = await import("../../occOps.js");
    const { profiles, dev, R } = await buildScene();
    const bodyId = buildItemShapeLocal(extrude, [sketch, extrude], 0.1);
    const bodyTris = occ.tessellate(bodyId, 0.1).indices.length;
    occ.releaseShape(bodyId);

    // Anchor just BEFORE the curve seam so the wrapped text runs across it —
    // the case the old clamp destroyed.
    const th = -0.3;
    const face = {
      cx: R * Math.cos(th),
      cy: R * Math.sin(th),
      cz: 2.5,
      nx: Math.cos(th),
      ny: Math.sin(th),
      nz: 0,
    };
    for (const deboss of [false, true]) {
      const params = { projection: "conform", distanceMm: 1, scale: 1, deboss };
      const stamp = buildEmbossStamp(
        profiles,
        face,
        params,
        [],
        null,
        { developable: dev },
        1,
      );
      expect(stamp?.mode).toBe("conform");
      const t0 = Date.now();
      const res = await ops.embossItem({
        source: extrude,
        stamp,
        allItems: [sketch, extrude],
        printPrecision: 0.1,
      });
      const ms = Date.now() - t0;
      expect(res).toBeTruthy();
      // Every glyph's relief adds geometry over the bare ring; a seam-squashed
      // stamp used to leave the body unchanged (or empty for deboss).
      expect(res.geometryData.indices.length).toBeGreaterThan(bodyTris);
      // And it completes in seconds, not minutes (degenerate slivers hung BOP).
      expect(ms).toBeLessThan(30000);
    }
  }, 240000);
});
