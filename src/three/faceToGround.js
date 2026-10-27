// Lay a body flat on a picked face: turn it so the face looks straight down,
// then drop it so its lowest point touches the ground (scene Y = 0).
import * as THREE from "three";
import { growFace, meshTopology } from "./meshPickCache.js";

// Triangles that turn by less than this still belong to the picked face.  An
// imported STL's "flat" face is a few microns out of plane, so one triangle's
// normal can be off by more than the face's; the area-weighted normal of the
// whole flat region averages that noise out.
const FLAT_COS = Math.cos((0.5 * Math.PI) / 180);

// The area-weighted normal, in the geometry's own frame, of the flat face that
// contains triangle `faceIndex`.
export function flatFaceNormal(geometry, faceIndex) {
  const tris = growFace(meshTopology(geometry), faceIndex, FLAT_COS);
  const p = geometry.attributes.position;
  const index = geometry.index;
  const vi = (k) => (index ? index.getX(k) : k);
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const sum = new THREE.Vector3();
  for (const t of tris) {
    a.fromBufferAttribute(p, vi(3 * t));
    b.fromBufferAttribute(p, vi(3 * t + 1));
    c.fromBufferAttribute(p, vi(3 * t + 2));
    // The cross product's length is twice the area: that is the weighting.
    sum.add(b.sub(a).cross(c.sub(a)));
  }
  return sum.normalize();
}

// The mesh pose that puts the face (normal and point in the mesh's local
// frame) face-down on the ground.  It turns about the picked point, so the
// body stays roughly where it was instead of swinging round its origin.
export function faceDownPose(mesh, localNormal, localPoint) {
  mesh.updateMatrixWorld(true);
  const normal = localNormal
    .clone()
    .applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld))
    .normalize();
  const pivot = mesh.localToWorld(localPoint.clone());
  const turn = new THREE.Quaternion().setFromUnitVectors(
    normal,
    new THREE.Vector3(0, -1, 0),
  );
  const quaternion = turn.clone().multiply(mesh.quaternion);
  const position = mesh.position.clone().sub(pivot).applyQuaternion(turn);
  position.add(pivot);
  position.y -= lowestY(mesh.geometry, position, quaternion, mesh.scale);
  return { position, quaternion };
}

// The lowest world Y of the geometry at this pose, from its vertices: a
// rotated bounding box reaches lower than the body does, and dropping by it
// would leave the body floating.
function lowestY(geometry, position, quaternion, scale) {
  const m = new THREE.Matrix4().compose(position, quaternion, scale);
  const p = geometry.attributes.position;
  const v = new THREE.Vector3();
  let min = Infinity;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m);
    if (v.y < min) min = v.y;
  }
  return min;
}

// The item's stored position and rotation for a mesh pose.  An extrude's mesh
// sits at the item position plus its centroid offset turned by the rotation,
// so the offset comes off under the NEW rotation.
export function itemPose(position, quaternion, extrudeLocalOffset) {
  const euler = new THREE.Euler().setFromQuaternion(quaternion, "XYZ");
  const off = extrudeLocalOffset
    ? new THREE.Vector3(
        extrudeLocalOffset.x,
        extrudeLocalOffset.y,
        extrudeLocalOffset.z,
      ).applyQuaternion(quaternion)
    : new THREE.Vector3();
  return {
    position: {
      x: position.x - off.x,
      y: position.y - off.y,
      z: position.z - off.z,
    },
    rotation: { x: euler.x, y: euler.y, z: euler.z },
  };
}
