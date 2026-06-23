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
  fitSphereToFaceSet,
  extractDevelopableProfile,
  validateFaceSetConnectivity,
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
// Signed volume of a triangle mesh (origin tetra sum) — detects a boolean that
// dropped/inverted the body (a clean R=1.5 sphere is ~14.1).
const meshVolume = (g) => {
  const p = g.positions,
    idx = g.indices;
  let v = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3,
      b = idx[t + 1] * 3,
      c = idx[t + 2] * 3;
    v +=
      (p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c])) /
      6;
  }
  return v;
};
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

  it("anchors the stamp on the bbox centre (invariant to vertex density)", () => {
    // The same triangle with extra collinear points on one edge: the vertex mean
    // shifts toward the denser edge, but the bbox centre doesn't — so the
    // centred stamp must be identical (text won't drift when re-simplified).
    const tri = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
    ];
    const dense = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 1.34, y: 0.66 },
      { x: 0.66, y: 1.34 },
      { x: 0, y: 2 },
    ];
    const mk = (poly) => ({
      polygon2D: poly,
      holes: [],
      position: O,
      rotation: O,
      normalWorld: { x: 0, y: 0, z: 1 },
    });
    const bboxCenter = (flat) => {
      let a = Infinity,
        b = -Infinity,
        c = Infinity,
        d = -Infinity;
      for (let i = 0; i < flat.length; i += 2) {
        a = Math.min(a, flat[i]);
        b = Math.max(b, flat[i]);
        c = Math.min(c, flat[i + 1]);
        d = Math.max(d, flat[i + 1]);
      }
      return [(a + b) / 2, (c + d) / 2];
    };
    const s1 = buildEmbossStamp([mk(tri)], topFace, params(), [], null);
    const s2 = buildEmbossStamp([mk(dense)], topFace, params(), [], null);
    const c1 = bboxCenter(s1.loops[0].outer);
    const c2 = bboxCenter(s2.loops[0].outer);
    expect(c1[0]).toBeCloseTo(0, 6); // centred on the bbox → ≈ 0
    expect(c1[0]).toBeCloseTo(c2[0], 6);
    expect(c1[1]).toBeCloseTo(c2[1], 6);
  });

  it("mirror H/V flip the stamp across the centred axes", () => {
    // An asymmetric (right-triangle) profile so a flip is detectable — a
    // symmetric one would map onto itself.
    const tri = {
      polygon2D: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 2 },
      ],
      holes: [],
      position: O,
      rotation: O,
      normalWorld: { x: 0, y: 0, z: 1 },
    };
    // The centred outer loop as a set of "x,y" keys.
    const keys = (s, fx = 1, fy = 1) => {
      const o = s.loops[0].outer;
      const set = [];
      for (let i = 0; i < o.length; i += 2)
        set.push(`${(fx * o[i]).toFixed(4)},${(fy * o[i + 1]).toFixed(4)}`);
      return set.sort();
    };
    const base = buildEmbossStamp([tri], topFace, params(), [], null);
    const mH = buildEmbossStamp(
      [tri],
      topFace,
      params({ mirrorH: true }),
      [],
      null,
    );
    const mV = buildEmbossStamp(
      [tri],
      topFace,
      params({ mirrorV: true }),
      [],
      null,
    );
    // mirrorH negates x: the mirrored loop matches the base with x flipped...
    expect(keys(mH)).toEqual(keys(base, -1, 1));
    // ...and genuinely differs from the un-mirrored loop.
    expect(keys(mH)).not.toEqual(keys(base));
    // mirrorV negates y likewise.
    expect(keys(mV)).toEqual(keys(base, 1, -1));
    expect(keys(mV)).not.toEqual(keys(base));
  });

  it("clips the relief to the face — geometry off the body isn't added", async () => {
    // Shoving the pad a full unit off-centre lands it half over the cube's edge;
    // the half hanging in space must be clipped, so nothing exceeds the cube's
    // ±1 footprint in X/Z (an un-clipped pad would reach ~1.3).
    const stamp = buildEmbossStamp(
      [profile],
      topFace,
      params({ offsetMm: 10, distanceMm: 3 }),
      [],
      null,
    );
    const res = await embossItem({
      source: cube,
      stamp,
      allItems: [cube],
      printPrecision: 0.1,
    });
    expect(res).toBeTruthy();
    const p = res.geometryData.positions;
    let mx = 0,
      mz = 0;
    for (let i = 0; i < p.length; i += 3) {
      mx = Math.max(mx, Math.abs(p[i]));
      mz = Math.max(mz, Math.abs(p[i + 2]));
    }
    expect(mx).toBeLessThan(1.05);
    expect(mz).toBeLessThan(1.05);
  });

  it("keeps the body anchored when the offset changes (no bbox drift)", async () => {
    // Not bbox-centring means the cube stays at its local frame (bottom y = -1)
    // no matter where the relief is offset to — so the object doesn't move.
    const minY = async (offsetMm) => {
      const stamp = buildEmbossStamp(
        [profile],
        topFace,
        params({ offsetMm }),
        [],
        null,
      );
      const res = await embossItem({
        source: cube,
        stamp,
        allItems: [cube],
        printPrecision: 0.1,
      });
      expect(res.centerOffset).toEqual({ cx: 0, cy: 0, cz: 0 });
      let m = Infinity;
      const p = res.geometryData.positions;
      for (let i = 1; i < p.length; i += 3) m = Math.min(m, p[i]);
      return m;
    };
    expect(await minY(0)).toBeCloseTo(await minY(6), 5);
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

  it("subdivides the conform mesh so the wrap isn't jaggy", () => {
    const cyl = { id: 3, type: "cylinder", position: O, rotation: O, scale: S };
    const smallProfile = {
      polygon2D: square(0.15),
      holes: [],
      position: O,
      rotation: O,
      normalWorld: { x: 0, y: 0, z: 1 },
    };
    const sideFace = { nx: 1, ny: 0, nz: 0, cx: 1, cy: 0, cz: 0 };
    const faceSet = {
      cylinder: { ax: 0, ay: 1, az: 0, cx: 0, cy: 0, cz: 0, radius: 1 },
    };
    const stamp = buildEmbossStamp(
      [smallProfile],
      sideFace,
      params({ projection: "conform", distanceMm: 3 }),
      [cyl],
      null,
      faceSet,
      1,
    );
    expect(stamp.mode).toBe("conform");
    const { positions, indices } = stamp.mesh;
    // A bare extruded square is ~12 triangles; subdivision blows that up.
    expect(indices.length / 3).toBeGreaterThan(100);
    // No giant facets — every edge stays a small fraction of the R=1 radius, so
    // the wrap reads as a smooth curve.
    let maxEdge = 0;
    for (let i = 0; i < indices.length; i += 3) {
      for (const [a, b] of [
        [0, 1],
        [1, 2],
        [2, 0],
      ]) {
        const ia = indices[i + a] * 3,
          ib = indices[i + b] * 3;
        maxEdge = Math.max(
          maxEdge,
          Math.hypot(
            positions[ia] - positions[ib],
            positions[ia + 1] - positions[ib + 1],
            positions[ia + 2] - positions[ib + 2],
          ),
        );
      }
    }
    expect(maxEdge).toBeLessThan(0.4);
  });

  it("debosses a conform recess without dropping the cylinder", async () => {
    const cyl = { id: 3, type: "cylinder", position: O, rotation: O, scale: S };
    const smallProfile = {
      polygon2D: square(0.15),
      holes: [],
      position: O,
      rotation: O,
      normalWorld: { x: 0, y: 0, z: 1 },
    };
    const sideFace = { nx: 1, ny: 0, nz: 0, cx: 1, cy: 0, cz: 0 };
    const faceSet = {
      cylinder: { ax: 0, ay: 1, az: 0, cx: 0, cy: 0, cz: 0, radius: 1 },
    };
    const stamp = buildEmbossStamp(
      [smallProfile],
      sideFace,
      params({ projection: "conform", deboss: true, distanceMm: 3 }),
      [cyl],
      null,
      faceSet,
    );
    const res = await embossItem({
      source: cyl,
      stamp,
      allItems: [cyl],
      printPrecision: 0.1,
    });
    expect(res).toBeTruthy();
    // The whole cylinder must survive the cut — its bbox spans the diameter (~2),
    // not just the small recessed pad.  (An inside-out cutter dropped it before.)
    const pos = res.geometryData.positions;
    let minX = Infinity,
      maxX = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      minX = Math.min(minX, pos[i]);
      maxX = Math.max(maxX, pos[i]);
    }
    expect(maxX - minX).toBeGreaterThan(1.5);
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

  it("divides the relief into the body's local frame on a scaled body", () => {
    // The stamp is built unscaled (the committed csg re-applies the body scale),
    // so a scale-2 body must halve the relief in local units or it'd render 2x
    // too big.  Compare the centred loop extent at scale 1 vs 2.
    const ext = (s) => {
      const o = s.loops[0].outer;
      let mn = Infinity,
        mx = -Infinity;
      for (let i = 0; i < o.length; i += 2) {
        mn = Math.min(mn, o[i]);
        mx = Math.max(mx, o[i]);
      }
      return mx - mn;
    };
    const s1 = buildEmbossStamp(
      [profile],
      topFace,
      params(),
      [],
      null,
      null,
      1,
    );
    const s2 = buildEmbossStamp(
      [profile],
      topFace,
      params(),
      [],
      null,
      null,
      2,
    );
    expect(ext(s2)).toBeCloseTo(ext(s1) / 2, 5);
    expect(s2.distance).toBeCloseTo(s1.distance / 2, 5);
  });

  it("wraps the relief over a sphere (conform projection)", async () => {
    const sph = { id: 4, type: "sphere", position: O, rotation: O, scale: S };
    const R = 1.5; // the OCC sphere primitive's local radius
    const smallProfile = {
      polygon2D: square(0.15),
      holes: [],
      position: O,
      rotation: O,
      normalWorld: { x: 0, y: 0, z: 1 },
    };
    // Anchor on the sphere's +Z pole.
    const face = { nx: 0, ny: 0, nz: 1, cx: 0, cy: 0, cz: R };
    const faceSet = { sphere: { cx: 0, cy: 0, cz: 0, radius: R } };
    const stamp = buildEmbossStamp(
      [smallProfile],
      face,
      params({ projection: "conform", distanceMm: 3 }),
      [sph],
      null,
      faceSet,
      1,
    );
    expect(stamp.mode).toBe("conform");
    // Every wrapped vertex sits on the sphere shell (R-margin .. R+relief).
    const p = stamp.mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      const d = Math.hypot(p[i], p[i + 1], p[i + 2]);
      expect(d).toBeGreaterThan(R - 0.1);
      expect(d).toBeLessThan(R + 0.4);
    }
    const res = await embossItem({
      source: sph,
      stamp,
      allItems: [sph],
      printPrecision: 0.1,
    });
    expect(res).toBeTruthy();
    // The raised pad protrudes past the bare R=1.5 sphere shell, so the unioned
    // result must reach beyond it somewhere (a flat projection never would).
    const rp = res.geometryData.positions;
    let maxD = 0;
    for (let i = 0; i < rp.length; i += 3)
      maxD = Math.max(maxD, Math.hypot(rp[i], rp[i + 1], rp[i + 2]));
    expect(maxD).toBeGreaterThan(R + 0.1);
  });

  it("conform keeps the body intact when the text is rotated (no eaten sphere)", async () => {
    // OCC's fuse of an analytic sphere vs the faceted wrapped stamp silently
    // dropped the sphere for some stamp orientations — a word rotated 90°/270°
    // left "the letters but most of the sphere missing".  The faceted-vs-faceted
    // boolean must keep the sphere whole at EVERY rotation.
    const R = 1.5;
    const sph = { id: 9, type: "sphere", position: O, rotation: O, scale: S };
    const profs = [];
    for (let gx = -0.6; gx <= 0.6001; gx += 0.3)
      profs.push({
        polygon2D: square(0.12),
        holes: [],
        position: { x: gx, y: 0, z: 0 },
        rotation: O,
        normalWorld: { x: 0, y: 0, z: 1 },
      });
    const face = { nx: 0, ny: 0, nz: 1, cx: 0, cy: 0, cz: R };
    for (const angleDeg of [0, 270]) {
      const stamp = buildEmbossStamp(
        profs,
        face,
        params({ projection: "conform", angleDeg }),
        [sph],
        null,
        { sphere: { cx: 0, cy: 0, cz: 0, radius: R } },
        1,
      );
      expect(tris(stamp.mesh)).toBeLessThan(5000); // the face-limit cap holds
      const res = await embossItem({
        source: sph,
        stamp,
        allItems: [sph],
        printPrecision: 0.1,
      });
      expect(res).toBeTruthy();
      // Full sphere ≈ 14.1; an eaten result collapses to ~1.5.
      expect(meshVolume(res.geometryData)).toBeGreaterThan(12);
    }
  });

  it("fits a sphere to a curved (3D-spanning) face set", () => {
    const C = [1, 2, 3],
      R = 2;
    const normals = [],
      positions = [];
    for (let i = 0; i <= 8; i++) {
      const theta = (i / 8) * 1.2; // a wide cap so the normals span 3D
      for (let j = 0; j < 12; j++) {
        const phi = (j / 12) * 2 * Math.PI;
        const nx = Math.sin(theta) * Math.cos(phi),
          ny = Math.sin(theta) * Math.sin(phi),
          nz = Math.cos(theta);
        normals.push([nx, ny, nz]);
        const px = C[0] + R * nx,
          py = C[1] + R * ny,
          pz = C[2] + R * nz;
        positions.push(px, py, pz, px, py, pz, px, py, pz);
      }
    }
    const sph = fitSphereToFaceSet(normals, positions);
    expect(sph).toBeTruthy();
    expect(sph.cx).toBeCloseTo(1, 1);
    expect(sph.cy).toBeCloseTo(2, 1);
    expect(sph.cz).toBeCloseTo(3, 1);
    expect(sph.radius).toBeCloseTo(2, 1);
    // A flat patch is not a sphere.
    const flatN = [
      [0, 0, 1],
      [0, 0, 1],
      [0, 0, 1],
      [0, 0, 1],
    ];
    const flatP = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
    expect(fitSphereToFaceSet(flatN, flatP)).toBeNull();
  });

  it("unrolls a developable (extruded-curve) wall so the wrap follows it", () => {
    // A quarter-circle arc (radius 2, in XZ) extruded along +Y to height 3 — a
    // developable wall a single cylinder COULD fit, but the unroll must follow the
    // actual arc (this is what makes a non-circular/bezier wall work).
    const N = 12,
      R = 2,
      H = 3;
    const positions = [],
      normals = [];
    for (let k = 0; k < N; k++) {
      const a0 = (k / N) * (Math.PI / 2),
        a1 = ((k + 1) / N) * (Math.PI / 2);
      const x0 = R * Math.cos(a0),
        z0 = R * Math.sin(a0),
        x1 = R * Math.cos(a1),
        z1 = R * Math.sin(a1);
      positions.push(x0, 0, z0, x1, 0, z1, x1, H, z1);
      positions.push(x0, 0, z0, x1, H, z1, x0, H, z0);
      const am = (a0 + a1) / 2;
      normals.push([Math.cos(am), 0, Math.sin(am)]);
      normals.push([Math.cos(am), 0, Math.sin(am)]);
    }
    const dev = extractDevelopableProfile(positions, normals);
    expect(dev).toBeTruthy();
    expect(Math.abs(dev.axis[1])).toBeGreaterThan(0.99); // axis ≈ Y
    expect(dev.curve.length).toBe(N + 1);
    expect(dev.arc[dev.arc.length - 1]).toBeCloseTo((R * Math.PI) / 2, 1);

    const prof = {
      polygon2D: square(0.2),
      holes: [],
      position: O,
      rotation: O,
      normalWorld: { x: 0, y: 0, z: 1 },
    };
    const am = Math.PI / 4;
    const face = {
      nx: Math.cos(am),
      ny: 0,
      nz: Math.sin(am),
      cx: R * Math.cos(am),
      cy: H / 2,
      cz: R * Math.sin(am),
    };
    const stamp = buildEmbossStamp(
      [prof],
      face,
      params({ projection: "conform", distanceMm: 3 }),
      [],
      null,
      { developable: dev },
      1,
    );
    expect(stamp.mode).toBe("conform");
    // Every wrapped vertex sits on the arc surface (radius ≈ R from the Y axis),
    // within the relief band — not floating off or buried.
    const p = stamp.mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      const rad = Math.hypot(p[i], p[i + 2]);
      expect(rad).toBeGreaterThan(R - 0.1);
      expect(rad).toBeLessThan(R + 0.4);
    }
  });

  it("validateFaceSetConnectivity gates multi-face selections at 45 degrees", () => {
    // A single coplanar quad (2 tris sharing an edge) — connected.
    const quad = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0];
    expect(validateFaceSetConnectivity(quad, 45)).toBe(true);
    expect(validateFaceSetConnectivity([0, 0, 0, 1, 0, 0, 0, 1, 0], 45)).toBe(
      true,
    ); // single tri

    // Two tris sharing edge (0,0,0)-(1,0,0), bent ~10° — within 45°, connected.
    const c = Math.cos((10 * Math.PI) / 180),
      s = Math.sin((10 * Math.PI) / 180);
    const gentle = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, c, s];
    expect(validateFaceSetConnectivity(gentle, 45)).toBe(true);

    // Same shared edge but bent 90° — exceeds 45°, so NOT connected.
    const sharp = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    expect(validateFaceSetConnectivity(sharp, 45)).toBe(false);

    // Two coplanar tris that don't share an edge — disconnected.
    const apart = [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0];
    expect(validateFaceSetConnectivity(apart, 45)).toBe(false);

    expect(validateFaceSetConnectivity([], 45)).toBe(false);
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
