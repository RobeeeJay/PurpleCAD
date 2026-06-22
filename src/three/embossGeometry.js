// Build the emboss "stamp" recipe from the selected sketch profiles, the target
// face, and the dialog params.  Runs on the renderer (needs THREE for the frame
// / wrap math); the recipe it returns is PURE DATA so occOps.js / occ-bridge.cjs
// can rebuild the stamp solid without THREE.
//
// Two projection modes:
//   • center  — a flat extruded prism transformed onto the centre-face plane.
//               stamp = { mode:"center", loops, placement, depth, deboss }
//   • conform — the relief wrapped around a cylinder (the face's curvature),
//               baked as a watertight mesh sewn via makeSolidFromMesh.
//               stamp = { mode:"conform", mesh:{positions,indices}, deboss }

import * as THREE from "three";
import { extrudeWithLivePolygon } from "./csgUtils.js";
import { withWinding } from "./sceneObjects/closedLoops.js";
import { MM_PER_UNIT } from "./sceneObjects.js";

// Small overlap/lead (local units, ~0.4mm) so the boolean opens cleanly: the
// emboss cutter sinks this far into the body, the deboss cutter starts this far
// outside the surface.
const EMBOSS_MARGIN = 0.04;

const quatOf = (rot) =>
  new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rot?.x || 0, rot?.y || 0, rot?.z || 0),
  );

// The selected sketch geometry, mapped into one common plane frame, centred on
// its combined centroid and scaled.  Returns point-array loops ([{x,y}]) so they
// can be wound flat (center mode) or fed to a Shape (conform mode).  invScale
// divides the world-unit sketch into the body's UNSCALED local frame (the stamp
// is built local, then the committed csg re-applies the body's scale), so a
// relief on a scaled body — every OCC primitive cylinder/sphere is scaled — keeps
// the size the user drew instead of being multiplied by the body's scale.
function commonFrameLoops(profiles, params, allItems, precision, invScale = 1) {
  const live = profiles
    .map(
      (p) =>
        extrudeWithLivePolygon({ profile: p }, allItems, precision).profile,
    )
    .filter((p) => p && p.polygon2D && p.polygon2D.length >= 3);
  if (live.length === 0) return null;

  const Q0inv = quatOf(live[0].rotation).invert();
  const P0 = new THREE.Vector3(
    live[0].position?.x || 0,
    live[0].position?.y || 0,
    live[0].position?.z || 0,
  );
  const toRef = (pt, Qi, Pi) =>
    new THREE.Vector3(pt.x, pt.y, 0)
      .applyQuaternion(Qi)
      .add(Pi)
      .sub(P0)
      .applyQuaternion(Q0inv);

  const refLoops = [];
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const prof of live) {
    const Qi = quatOf(prof.rotation);
    const Pi = new THREE.Vector3(
      prof.position?.x || 0,
      prof.position?.y || 0,
      prof.position?.z || 0,
    );
    const map = (p) => {
      const v = toRef(p, Qi, Pi);
      return { x: v.x, y: v.y };
    };
    const outer = prof.polygon2D.map(map);
    const holes = (prof.holes || [])
      .filter((h) => h && h.length >= 3)
      .map((h) => h.map(map));
    for (const p of outer) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    refLoops.push({ outer, holes });
  }

  // Anchor on the BOUNDING-BOX centre, not the vertex mean.  The mean is biased
  // by vertex density, so re-simplifying text at a different resolution shifts
  // it and the emboss drifts; the bbox extremes are preserved, so it stays put.
  const cu = Number.isFinite(minX) ? (minX + maxX) / 2 : 0,
    cv = Number.isFinite(minY) ? (minY + maxY) / 2 : 0;
  const scale = params.scale > 0 ? params.scale : 1;
  // Mirror flips a centred axis; winding is re-normalised downstream (withWinding
  // for center mode, OrientClosedSolid for the conform mesh) so the flip is safe.
  const mx = params.mirrorH ? -1 : 1;
  const my = params.mirrorV ? -1 : 1;
  const center = (p) => ({
    x: (p.x - cu) * scale * mx * invScale,
    y: (p.y - cv) * scale * my * invScale,
  });
  return refLoops.map((lp) => ({
    outer: lp.outer.map(center),
    holes: lp.holes.map((h) => h.map(center)),
  }));
}

// Wrap the centred loops around a cylinder (axis A through centre C, radius R)
// and bake a watertight mesh.  The loops' x maps to arc length, y to the axis,
// the extrude depth to the radial relief.  The click point anchors the wrap.
function buildConformMesh(loops, cyl, face, params, invScale = 1) {
  const A = new THREE.Vector3(cyl.ax, cyl.ay, cyl.az).normalize();
  const C = new THREE.Vector3(cyl.cx || 0, cyl.cy || 0, cyl.cz || 0);
  const P = new THREE.Vector3(face.cx, face.cy, face.cz).sub(C);
  const along = P.dot(A);
  const Pperp = P.clone().sub(A.clone().multiplyScalar(along));
  const R = cyl.radius > 1e-3 ? cyl.radius : Math.max(1e-3, Pperp.length());
  const e1 = Pperp.clone().normalize();
  const e2 = A.clone().cross(e1).normalize();

  // The loops are already in the body's local frame (commonFrameLoops applied
  // invScale); the relief depth / offsets are still world-unit, so divide them
  // too — R is local, so arc length u/R then stays consistent.
  const relief = Math.max(
    1e-4,
    ((params.distanceMm || 0) / MM_PER_UNIT) * invScale,
  );
  const prismDepth = relief + EMBOSS_MARGIN;
  const shapes = loops.map((lp) => {
    const s = new THREE.Shape(lp.outer.map((p) => new THREE.Vector2(p.x, p.y)));
    lp.holes.forEach((h) =>
      s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y)))),
    );
    return s;
  });
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth: prismDepth,
    bevelEnabled: false,
    curveSegments: 8,
  });

  const ang = ((params.angleDeg || 0) * Math.PI) / 180;
  const ca = Math.cos(ang),
    sa = Math.sin(ang);
  const offsetH = ((params.offsetMm || 0) / MM_PER_UNIT) * invScale; // around the cylinder
  const offsetV = ((params.offsetVMm || 0) / MM_PER_UNIT) * invScale; // along the axis
  const deboss = !!params.deboss;
  const pos = geo.attributes.position;
  const out = new Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i),
      py = pos.getY(i),
      pz = pos.getZ(i);
    const u = px * ca - py * sa + offsetH; // arc length around the cylinder
    const w = px * sa + py * ca + offsetV; // axial position
    const theta = u / R;
    const r = deboss ? R + EMBOSS_MARGIN - pz : R - EMBOSS_MARGIN + pz;
    const cos = Math.cos(theta) * r,
      sin = Math.sin(theta) * r;
    const axial = along + w;
    out[i * 3] = C.x + A.x * axial + e1.x * cos + e2.x * sin;
    out[i * 3 + 1] = C.y + A.y * axial + e1.y * cos + e2.y * sin;
    out[i * 3 + 2] = C.z + A.z * axial + e1.z * cos + e2.z * sin;
  }
  const indices = geo.index ? Array.from(geo.index.array) : null;
  geo.dispose();
  return { positions: out, indices };
}

// Wrap the centred loops over a SPHERE (centre C, radius R) via the exponential
// map at the anchor (face point): a loop point at in-plane offset (u,w) lands a
// geodesic distance hypot(u,w) from the anchor, so the relief curves over the
// surface in both directions.  The extrude depth becomes radial relief.
function buildSphereConformMesh(loops, sph, face, params, invScale = 1) {
  const C = new THREE.Vector3(sph.cx || 0, sph.cy || 0, sph.cz || 0);
  const Pn = new THREE.Vector3(face.cx, face.cy, face.cz).sub(C);
  const R = sph.radius > 1e-3 ? sph.radius : Math.max(1e-3, Pn.length());
  const N = Pn.clone().normalize(); // anchor direction (the "pole")
  // Tangent basis at the anchor.
  const tmp =
    Math.abs(N.x) < 0.9
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
  const t1 = new THREE.Vector3().crossVectors(N, tmp).normalize();
  const t2 = new THREE.Vector3().crossVectors(N, t1).normalize();

  const relief = Math.max(
    1e-4,
    ((params.distanceMm || 0) / MM_PER_UNIT) * invScale,
  );
  const prismDepth = relief + EMBOSS_MARGIN;
  const shapes = loops.map((lp) => {
    const s = new THREE.Shape(lp.outer.map((p) => new THREE.Vector2(p.x, p.y)));
    lp.holes.forEach((h) =>
      s.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y)))),
    );
    return s;
  });
  const geo = new THREE.ExtrudeGeometry(shapes, {
    depth: prismDepth,
    bevelEnabled: false,
    curveSegments: 8,
  });

  const ang = ((params.angleDeg || 0) * Math.PI) / 180;
  const ca = Math.cos(ang),
    sa = Math.sin(ang);
  const offsetH = ((params.offsetMm || 0) / MM_PER_UNIT) * invScale;
  const offsetV = ((params.offsetVMm || 0) / MM_PER_UNIT) * invScale;
  const deboss = !!params.deboss;
  const pos = geo.attributes.position;
  const out = new Array(pos.count * 3);
  const dir = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i),
      py = pos.getY(i),
      pz = pos.getZ(i);
    const u = px * ca - py * sa + offsetH;
    const w = px * sa + py * ca + offsetV;
    const d = Math.hypot(u, w); // geodesic distance from the anchor
    const r = deboss ? R + EMBOSS_MARGIN - pz : R - EMBOSS_MARGIN + pz;
    if (d < 1e-9) {
      dir.copy(N);
    } else {
      const phi = d / R; // angle subtended
      const cphi = Math.cos(phi),
        sphi = Math.sin(phi);
      // exp map: N·cos φ + (unit tangent direction)·sin φ.
      const tu = u / d,
        tw = w / d;
      dir
        .copy(N)
        .multiplyScalar(cphi)
        .addScaledVector(t1, tu * sphi)
        .addScaledVector(t2, tw * sphi);
    }
    out[i * 3] = C.x + dir.x * r;
    out[i * 3 + 1] = C.y + dir.y * r;
    out[i * 3 + 2] = C.z + dir.z * r;
  }
  const indices = geo.index ? Array.from(geo.index.array) : null;
  geo.dispose();
  return { positions: out, indices };
}

// profiles: extrude-style profile objects.  face: { nx,ny,nz, cx,cy,cz } in the
// body's LOCAL frame.  faceSet may carry a { cylinder } or { sphere } for conform.
// bodyScale is the target's (uniform) scale — the stamp is built in the body's
// unscaled local frame, so world-unit measures are divided by it.
export function buildEmbossStamp(
  profiles,
  face,
  params,
  allItems,
  precision,
  faceSet,
  bodyScale = 1,
) {
  if (!profiles || profiles.length === 0 || !face) return null;
  const invScale = 1 / (Math.abs(bodyScale) > 1e-9 ? bodyScale : 1);
  const loops = commonFrameLoops(
    profiles,
    params,
    allItems,
    precision,
    invScale,
  );
  if (!loops) return null;

  if (params.projection === "conform" && faceSet?.sphere) {
    const mesh = buildSphereConformMesh(
      loops,
      faceSet.sphere,
      face,
      params,
      invScale,
    );
    if (mesh && mesh.positions.length >= 9)
      return { mode: "conform", mesh, deboss: !!params.deboss };
    // Fall through to center if the wrap produced nothing.
  }

  const cylinder = faceSet?.cylinder;
  if (params.projection === "conform" && cylinder) {
    const mesh = buildConformMesh(loops, cylinder, face, params, invScale);
    if (mesh && mesh.positions.length >= 9)
      return { mode: "conform", mesh, deboss: !!params.deboss };
    // Fall through to center if the wrap produced nothing.
  }

  // Center-face projection: a flat extruded prism transformed onto the plane.
  const flat = (arr) => arr.flatMap((p) => [p.x, p.y]);
  const flatLoops = loops.map((lp) => ({
    outer: flat(withWinding(lp.outer, true)), // CCW
    holes: lp.holes.map((h) => flat(withWinding(h, false))), // CW
  }));

  const Nf = new THREE.Vector3(face.nx, face.ny, face.nz).normalize();
  const F = new THREE.Vector3(face.cx, face.cy, face.cz);
  const qAlign = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    Nf,
  );
  const angleRad = ((params.angleDeg || 0) * Math.PI) / 180;
  const q = new THREE.Quaternion()
    .setFromAxisAngle(Nf, angleRad)
    .multiply(qAlign);
  const euler = new THREE.Euler().setFromQuaternion(q, "XYZ");

  const offsetH = ((params.offsetMm || 0) / MM_PER_UNIT) * invScale;
  const offsetV = ((params.offsetVMm || 0) / MM_PER_UNIT) * invScale;
  const distance = Math.max(
    1e-4,
    ((params.distanceMm || 0) / MM_PER_UNIT) * invScale,
  );
  const deboss = !!params.deboss;
  const inPlaneX = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const inPlaneY = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  // The center stamp is a DEEP prism that passes all the way through the body
  // along the face normal.  embossItem intersects it with the body to get the
  // projected footprint (which exists only where the geometry actually touches a
  // face), then raises/lowers that by `distance` — so anything that doesn't hit
  // a face is clipped rather than left floating.
  const TOOL_HALF = 50; // local units; covers any reasonable body
  const base = F.clone()
    .add(Nf.clone().multiplyScalar(-TOOL_HALF))
    .add(inPlaneX.multiplyScalar(offsetH))
    .add(inPlaneY.multiplyScalar(offsetV));

  return {
    mode: "center",
    loops: flatLoops,
    placement: {
      tx: base.x,
      ty: base.y,
      tz: base.z,
      rx: euler.x,
      ry: euler.y,
      rz: euler.z,
    },
    depth: 2 * TOOL_HALF,
    normal: { nx: Nf.x, ny: Nf.y, nz: Nf.z },
    distance,
    deboss,
  };
}
