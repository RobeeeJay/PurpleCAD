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
// can be wound flat (center mode) or fed to a Shape (conform mode).
function commonFrameLoops(profiles, params, allItems, precision) {
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
  let sx = 0,
    sy = 0,
    n = 0;
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
    outer.forEach((p) => {
      sx += p.x;
      sy += p.y;
      n++;
    });
    refLoops.push({ outer, holes });
  }

  const cu = n ? sx / n : 0,
    cv = n ? sy / n : 0;
  const scale = params.scale > 0 ? params.scale : 1;
  const center = (p) => ({ x: (p.x - cu) * scale, y: (p.y - cv) * scale });
  return refLoops.map((lp) => ({
    outer: lp.outer.map(center),
    holes: lp.holes.map((h) => h.map(center)),
  }));
}

// Wrap the centred loops around a cylinder (axis through the local origin) and
// bake a watertight mesh.  The loops' x maps to arc length, y to the axis, the
// extrude depth to the radial relief.
function buildConformMesh(loops, cyl, face, params) {
  const A = new THREE.Vector3(cyl.ax, cyl.ay, cyl.az).normalize();
  const P = new THREE.Vector3(face.cx, face.cy, face.cz);
  const along = P.dot(A);
  const Pperp = P.clone().sub(A.clone().multiplyScalar(along));
  const R = Math.max(1e-3, Pperp.length());
  const e1 = Pperp.clone().normalize();
  const e2 = A.clone().cross(e1).normalize();

  const relief = Math.max(1e-4, (params.distanceMm || 0) / MM_PER_UNIT);
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
  const offset = (params.offsetMm || 0) / MM_PER_UNIT;
  const deboss = !!params.deboss;
  const pos = geo.attributes.position;
  const out = new Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i),
      py = pos.getY(i),
      pz = pos.getZ(i);
    const u = px * ca - py * sa + offset; // arc length around the cylinder
    const w = px * sa + py * ca; // axial position
    const theta = u / R;
    const r = deboss ? R + EMBOSS_MARGIN - pz : R - EMBOSS_MARGIN + pz;
    const cos = Math.cos(theta) * r,
      sin = Math.sin(theta) * r;
    const axial = along + w;
    out[i * 3] = A.x * axial + e1.x * cos + e2.x * sin;
    out[i * 3 + 1] = A.y * axial + e1.y * cos + e2.y * sin;
    out[i * 3 + 2] = A.z * axial + e1.z * cos + e2.z * sin;
  }
  const indices = geo.index ? Array.from(geo.index.array) : null;
  geo.dispose();
  return { positions: out, indices };
}

// profiles: extrude-style profile objects.  face: { nx,ny,nz, cx,cy,cz } in the
// body's LOCAL frame.  faceSet may carry a { cylinder:{ax,ay,az} } for conform.
export function buildEmbossStamp(
  profiles,
  face,
  params,
  allItems,
  precision,
  faceSet,
) {
  if (!profiles || profiles.length === 0 || !face) return null;
  const loops = commonFrameLoops(profiles, params, allItems, precision);
  if (!loops) return null;

  const cylinder = faceSet?.cylinder;
  if (params.projection === "conform" && cylinder) {
    const mesh = buildConformMesh(loops, cylinder, face, params);
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

  const offset = (params.offsetMm || 0) / MM_PER_UNIT;
  const distance = Math.max(1e-4, (params.distanceMm || 0) / MM_PER_UNIT);
  const deboss = !!params.deboss;
  const inPlaneX = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const base = F.clone()
    .add(Nf.clone().multiplyScalar(deboss ? EMBOSS_MARGIN : -EMBOSS_MARGIN))
    .add(inPlaneX.multiplyScalar(offset));
  const depth = (deboss ? -1 : 1) * (distance + EMBOSS_MARGIN);

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
    depth,
    deboss,
  };
}
