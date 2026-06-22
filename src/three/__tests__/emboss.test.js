// Emboss op: stamp sketch geometry onto a body's face as a raised (emboss) or
// recessed (deboss) relief, and rebuild an "emboss" regenerator from its recipe.

import { describe, it, expect, beforeAll } from "vitest";
import { createRequire } from "module";
import * as THREE from "three";
import { ensureOcc } from "../occ/init.js";
import { embossItem } from "../occClient.js";
import { buildEmbossStamp } from "../embossGeometry.js";
import { buildItemShapeLocal } from "../occOps.js";
import {
  growConnectedFaceSet,
  fitCylinderToFaceSet,
} from "../embossFaceSet.js";
import { regenerateItemsForResolution } from "../regenerateItems.js";

const occ = createRequire(import.meta.url)(
  "../../../native/occ-addon/build/Release/occ_addon.node",
);
const occTess = (id, prec) => occ.tessellate(id, prec);

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };
const cube = { id: 1, type: "cube", position: O, rotation: O, scale: S };

// A 6mm square profile on a sketch at the origin (normal +Z), in local units.
const square = (s) => [
  { x: -s, y: -s },
  { x: s, y: -s },
  { x: s, y: s },
  { x: -s, y: s },
];
const profile = {
  polygon2D: square(0.3),
  holes: [],
  position: O,
  rotation: O,
  normalWorld: { x: 0, y: 0, z: 1 },
};
// Cube top face (y = 1) in the cube's local frame.
const topFace = { nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 };
const params = (extra) => ({
  deboss: false,
  angleDeg: 0,
  offsetMm: 0,
  scale: 1,
  distanceMm: 4,
  ...extra,
});
const tris = (g) => g.indices.length / 3;
const topRing = (g) => {
  const pos = g.positions,
    idx = g.indices;
  let n = 0;
  for (let i = 0; i < idx.length; i += 3) {
    let onTop = true;
    for (let k = 0; k < 3; k++)
      if (Math.abs(pos[idx[i + k] * 3 + 1] - 1) > 1e-3) {
        onTop = false;
        break;
      }
    if (onTop) n++;
  }
  return n;
};

describe("emboss op", () => {
  it("embosses a raised pad onto the body (adds faces)", async () => {
    const stamp = buildEmbossStamp([profile], topFace, params(), [], null);
    expect(stamp).toBeTruthy();
    const res = await embossItem({
      source: cube,
      stamp,
      allItems: [cube],
      printPrecision: 0.1,
    });
    expect(res).toBeTruthy();
    // A bare cube is 12 triangles; a raised pad adds walls + a top.
    expect(tris(res.geometryData)).toBeGreaterThan(20);
  });

  it("debosses a recess that opens a ring in the top face", async () => {
    const stamp = buildEmbossStamp(
      [profile],
      topFace,
      params({ deboss: true }),
      [],
      null,
    );
    const res = await embossItem({
      source: cube,
      stamp,
      allItems: [cube],
      printPrecision: 0.05,
    });
    expect(res).toBeTruthy();
    // The top face is now an annulus around the recess opening, not one quad.
    expect(topRing(res.geometryData)).toBeGreaterThan(2);
  });

  it("wraps the relief around a cylinder (conform projection)", async () => {
    const cyl = { id: 3, type: "cylinder", position: O, rotation: O, scale: S };
    // A small square on a sketch (normal +Z), wrapped onto the cylinder side.
    const smallProfile = {
      polygon2D: square(0.15),
      holes: [],
      position: O,
      rotation: O,
      normalWorld: { x: 0, y: 0, z: 1 },
    };
    const sideFace = { nx: 1, ny: 0, nz: 0, cx: 1, cy: 0, cz: 0 };
    const faceSet = { cylinder: { ax: 0, ay: 1, az: 0 } };
    const stamp = buildEmbossStamp(
      [smallProfile],
      sideFace,
      params({ projection: "conform", distanceMm: 3 }),
      [cyl],
      null,
      faceSet,
    );
    expect(stamp).toBeTruthy();
    expect(stamp.mode).toBe("conform");
    const bareTris = tris(occTess(buildItemShapeLocal(cyl, [cyl], 0.1), 0.1));
    const res = await embossItem({
      source: cyl,
      stamp,
      allItems: [cyl],
      printPrecision: 0.1,
    });
    expect(res).toBeTruthy();
    // The wrapped pad adds geometry to the smooth cylinder.
    expect(tris(res.geometryData)).toBeGreaterThan(bareTris);
  });

  it("grows a connected face set and fits a cylinder to it", () => {
    // A faceted tube along Z (radius 1, 24 facets) — a CSG-style cylinder.
    const N = 24,
      R = 1,
      H = 2;
    const p = [];
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * 2 * Math.PI,
        a1 = ((k + 1) / N) * 2 * Math.PI;
      const x0 = R * Math.cos(a0),
        y0 = R * Math.sin(a0),
        x1 = R * Math.cos(a1),
        y1 = R * Math.sin(a1);
      p.push(x0, y0, -H / 2, x1, y1, -H / 2, x1, y1, H / 2);
      p.push(x0, y0, -H / 2, x1, y1, H / 2, x0, y0, H / 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(p), 3),
    );
    const grown = growConnectedFaceSet(g, 0, { x: 1, y: 0, z: 0 }, 30);
    expect(grown).toBeTruthy();
    // It should grab most facets (each 2 tris) by following the gentle dihedral.
    expect(grown.normals.length).toBeGreaterThan(40);
    const cyl = fitCylinderToFaceSet(grown.normals, grown.centroids);
    expect(cyl).toBeTruthy();
    expect(Math.abs(cyl.az)).toBeGreaterThan(0.99); // axis ≈ Z
    expect(cyl.radius).toBeGreaterThan(0.9);
    expect(cyl.radius).toBeLessThan(1.1);
  });

  it("fits no cylinder to a flat face set (falls back to center)", () => {
    const p = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0];
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(p), 3),
    );
    const grown = growConnectedFaceSet(g, 0, { x: 0, y: 0, z: 1 }, 30);
    expect(grown).toBeTruthy();
    expect(fitCylinderToFaceSet(grown.normals, grown.centroids)).toBeNull();
  });

  it("rebuilds an emboss regenerator from its embedded recipe", async () => {
    const stamp = buildEmbossStamp([profile], topFace, params(), [], null);
    const item = {
      id: 2,
      type: "csg",
      position: O,
      rotation: O,
      scale: S,
      geometryData: null,
      regenerator: {
        kind: "emboss",
        source: cube,
        profiles: [profile],
        face: topFace,
        params: params(),
        stamp,
        centerOffset: { cx: 0, cy: 0, cz: 0 },
        regeneratedAt: "dirty",
      },
    };
    const out = await regenerateItemsForResolution([item], 0.1);
    const u = out.find((i) => i.id === 2);
    expect(u.geometryData).toBeTruthy();
    expect(u.geometryData.positions.length).toBeGreaterThan(0);
  });
});
