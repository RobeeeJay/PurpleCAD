// Pure geometry helpers for the extrude flow: build the translucent preview
// prism, derive a 2D profile from a clicked solid face, and the 2D convex hull
// that profile uses.  No scene/store state — split out of extrude.js so that
// file stays focused on the hover/click/commit pipeline.

import * as THREE from "three";
import { CUT_FACE_HIGHLIGHT, EXTRUDE_FACE_HIGHLIGHT } from "../theme.js";

// Build the translucent preview prism for a profile + depth.  Returns the mesh
// (positioned/oriented in world space); the caller owns adding/removing it from
// the scene.  cutMode tints it red (subtracts) vs blue (adds).  startOffset
// shifts the prism's base along the profile normal (local +Z) so the extrude
// can begin from a face / plane other than the sketch plane.
export function makeExtrudePreviewMesh(
  profile,
  depth,
  cutMode,
  startOffset = 0,
) {
  const poly = profile.polygon2D;
  if (!poly || poly.length < 3) return null;
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
  (profile.holes || []).forEach((h) => {
    if (h && h.length >= 3)
      shape.holes.push(
        new THREE.Path(h.map((p) => new THREE.Vector2(p.x, p.y))),
      );
  });
  // ExtrudeGeometry only accepts a positive depth.  For a negative depth we
  // extrude by the absolute value then translate the geometry so the prism
  // extends in the -Z (sketch-local) direction instead.
  const absDepth = Math.max(0.05, Math.abs(depth));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: absDepth,
    bevelEnabled: false,
  });
  // Base sits at local z=0; negative depth pushes it to -absDepth.  startOffset
  // then slides the whole prism along the normal.
  const baseZ = (depth < 0 ? -absDepth : 0) + (startOffset || 0);
  if (baseZ !== 0) geo.translate(0, 0, baseZ);
  const mat = new THREE.MeshBasicMaterial({
    color: cutMode ? CUT_FACE_HIGHLIGHT : EXTRUDE_FACE_HIGHLIGHT,
    transparent: true,
    opacity: cutMode ? 0.5 : 0.35,
    side: THREE.DoubleSide,
    depthTest: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const rot = profile.rotation;
  mesh.rotation.set(rot.x, rot.y, rot.z);
  const pos = profile.position;
  mesh.position.set(pos.x, pos.y, pos.z);
  mesh.renderOrder = 10;
  return mesh;
}

// Gift-wrap (Jarvis march) 2D convex hull.
function convexHull2D(points) {
  if (points.length <= 3) return points;
  let lo = 0;
  for (let i = 1; i < points.length; i++)
    if (points[i].x < points[lo].x) lo = i;
  const hull = [];
  let p = lo,
    safety = 0;
  do {
    hull.push(points[p]);
    let q = (p + 1) % points.length;
    for (let i = 0; i < points.length; i++) {
      const cross =
        (points[q].x - points[p].x) * (points[i].y - points[p].y) -
        (points[q].y - points[p].y) * (points[i].x - points[p].x);
      if (cross > 0) q = i;
    }
    p = q;
  } while (p !== lo && ++safety <= points.length + 2);
  return hull;
}

// Derive a flat 2D profile (+ world placement) from a raycast hit on a solid
// face: gathers the coplanar face vertices, projects them into a face-local 2D
// frame, and convex-hulls them.  Returns null when fewer than 3 points.
export function extractFaceProfile(hit) {
  const hitMesh = hit.object;
  const localNormal = hit.face.normal.clone();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(hitMesh.matrixWorld);
  const worldNormal = localNormal
    .clone()
    .applyMatrix3(normalMatrix)
    .normalize();

  const posAttr = hitMesh.geometry.getAttribute("position");
  const idxAttr = hitMesh.geometry.index;
  const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
  const vA = new THREE.Vector3(),
    vB = new THREE.Vector3(),
    vC = new THREE.Vector3();
  const seen = new Map();
  for (let i = 0; i < triCount; i++) {
    let a, b, c;
    if (idxAttr) {
      a = idxAttr.getX(i * 3);
      b = idxAttr.getX(i * 3 + 1);
      c = idxAttr.getX(i * 3 + 2);
    } else {
      a = i * 3;
      b = i * 3 + 1;
      c = i * 3 + 2;
    }
    vA.set(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a));
    vB.set(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b));
    vC.set(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c));
    const triNorm = new THREE.Vector3()
      .crossVectors(
        new THREE.Vector3().subVectors(vB, vA),
        new THREE.Vector3().subVectors(vC, vA),
      )
      .normalize();
    if (triNorm.dot(localNormal) < 0.99) continue;
    for (const v of [vA, vB, vC]) {
      const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
      if (!seen.has(key))
        seen.set(key, v.clone().applyMatrix4(hitMesh.matrixWorld));
    }
  }
  if (seen.size < 3) return null;

  // Build face-local 2D coordinate system consistent with the rotation quaternion
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 0, 1),
    worldNormal,
  );
  const euler = new THREE.Euler().setFromQuaternion(q);
  const xLocal = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const yLocal = new THREE.Vector3(0, 1, 0).applyQuaternion(q);

  const origin = hit.point.clone();
  const verts2D = [...seen.values()].map((v) => {
    const rel = v.clone().sub(origin);
    return { x: rel.dot(xLocal), y: rel.dot(yLocal) };
  });
  const polygon2D = convexHull2D(verts2D);
  if (polygon2D.length < 3) return null;

  return {
    type: "face",
    polygon2D,
    position: { x: origin.x, y: origin.y, z: origin.z },
    rotation: { x: euler.x, y: euler.y, z: euler.z },
    normalWorld: { x: worldNormal.x, y: worldNormal.y, z: worldNormal.z },
    // The solid the face came from — used as the natural target of a
    // cut-extrusion when one is requested via the depth-overlay toggle.
    sourceItemId: hitMesh.userData?.itemId ?? null,
  };
}
