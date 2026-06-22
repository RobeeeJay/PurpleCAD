// Build the emboss "stamp" recipe — flat 2D loops + a placement transform —
// from the selected sketch profiles, the target face plane, and the dialog
// params.  This runs on the renderer (it needs THREE for the frame math); the
// recipe it returns is PURE DATA so occOps.js / occ-bridge.cjs can rebuild the
// stamp solid (extrude + transform + boolean) without THREE.

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

// profiles: array of extrude-style profile objects (polygon2D/holes in their
// sketch frame + sketch position/rotation).  face: { nx,ny,nz, cx,cy,cz } in the
// body's LOCAL frame.  params: { deboss, angleDeg, offsetMm, scale, distanceMm }.
export function buildEmbossStamp(profiles, face, params, allItems, precision) {
  if (!profiles || profiles.length === 0 || !face) return null;
  // Re-derive each profile's polygon from its live sketch.
  const live = profiles
    .map(
      (p) =>
        extrudeWithLivePolygon({ profile: p }, allItems, precision).profile,
    )
    .filter((p) => p && p.polygon2D && p.polygon2D.length >= 3);
  if (live.length === 0) return null;

  // Reference plane frame = the first profile's sketch frame.  Every profile's
  // points are mapped through world into this frame so coplanar loops/glyphs
  // keep their relative layout regardless of which sketch they came from.
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
  const flat = (arr) => arr.flatMap((p) => [p.x, p.y]);
  const loops = refLoops.map((lp) => ({
    outer: flat(withWinding(lp.outer.map(center), true)), // CCW
    holes: lp.holes.map((h) => flat(withWinding(h.map(center), false))), // CW
  }));

  // Placement onto the face (body-local frame).  Align the stamp's +Z to the
  // face normal and apply the in-plane angle.  Keep the SAME orientation for
  // emboss and deboss (deboss extrudes with a negative depth) so the relief
  // isn't mirrored between the two.
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
    loops,
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
