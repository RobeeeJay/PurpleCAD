// Laying a body on a picked face: the face must end up looking straight down
// with the body's lowest point on the ground, wherever the body was turned.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { faceDownPose, flatFaceNormal, itemPose } from "../faceToGround.js";

const v = (x, y, z) => new THREE.Vector3(x, y, z);

// A 2 x 1 x 0.5 box, turned off every axis and lifted off the ground.
function tiltedBox() {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.5));
  mesh.position.set(3, 5, -2);
  mesh.rotation.set(0.4, -0.7, 1.2);
  mesh.scale.set(1.5, 1, 2);
  mesh.updateMatrixWorld(true);
  return mesh;
}

function worldLowestY(mesh, position, quaternion) {
  const m = new THREE.Matrix4().compose(position, quaternion, mesh.scale);
  const p = mesh.geometry.attributes.position;
  let min = Infinity;
  for (let i = 0; i < p.count; i++)
    min = Math.min(min, v(0, 0, 0).fromBufferAttribute(p, i).applyMatrix4(m).y);
  return min;
}

describe("laying a body on a face", () => {
  it("turns the picked face to look straight down", () => {
    const mesh = tiltedBox();
    const { position, quaternion } = faceDownPose(
      mesh,
      v(0, 0, 1),
      v(0.2, 0.1, 0.25),
    );
    const m = new THREE.Matrix4().compose(position, quaternion, mesh.scale);
    const n = v(0, 0, 1)
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(m))
      .normalize();
    expect(n.y, `face normal after the turn: ${n.toArray()}`).toBeCloseTo(
      -1,
      9,
    );
  });

  it("drops the body until its lowest point touches the ground", () => {
    const mesh = tiltedBox();
    const { position, quaternion } = faceDownPose(
      mesh,
      v(-1, 0, 0),
      v(-1, 0.2, 0.1),
    );
    const low = worldLowestY(mesh, position, quaternion);
    expect(low, `lowest point at y = ${low}`).toBeCloseTo(0, 9);
  });

  it("turns about the picked point, so the body stays where it was", () => {
    // Turning about the body's origin would swing an off-centre face across
    // the scene; the picked point keeps its place on the ground plan.
    const mesh = tiltedBox();
    const local = v(0.8, -0.5, 0.1);
    const before = mesh.localToWorld(local.clone());
    const { position, quaternion } = faceDownPose(mesh, v(0, -1, 0), local);
    const after = local
      .clone()
      .applyMatrix4(
        new THREE.Matrix4().compose(position, quaternion, mesh.scale),
      );
    expect(after.x, `x ${before.x} -> ${after.x}`).toBeCloseTo(before.x, 9);
    expect(after.z, `z ${before.z} -> ${after.z}`).toBeCloseTo(before.z, 9);
  });

  it("takes the whole flat face's normal, not the clicked triangle's", () => {
    // A unit square on z = 0 split into four triangles about its centre, with
    // the centre raised a hair: each triangle tilts 0.06 degrees, the face as
    // a whole not at all -- the case of an imported STL's not-quite-flat face.
    const lift = 0.0005;
    const pts = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0.5, 0.5, lift],
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts.flat(), 3));
    g.setIndex([0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]);
    const n = flatFaceNormal(g, 0);
    const tilt = (Math.acos(Math.min(1, n.z)) * 180) / Math.PI;
    expect(tilt, `face normal ${n.toArray()}`).toBeLessThan(1e-6);
  });

  it("stores the item pose an extrude's mesh is built from", () => {
    // The scene builder places an extrude's mesh at the item position plus
    // its centroid offset turned by the rotation; the stored pose has to
    // rebuild the very mesh pose that was previewed.
    const offset = { x: 0.7, y: -0.3, z: 0.2 };
    const position = v(1, 2, 3);
    const quaternion = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(0.5, 0.25, -0.9),
    );
    const pose = itemPose(position, quaternion, offset);
    const rot = new THREE.Euler(
      pose.rotation.x,
      pose.rotation.y,
      pose.rotation.z,
    );
    const rebuilt = v(offset.x, offset.y, offset.z)
      .applyEuler(rot)
      .add(v(pose.position.x, pose.position.y, pose.position.z));
    expect(
      rebuilt.distanceTo(position),
      `rebuilt at ${rebuilt.toArray()}`,
    ).toBeLessThan(1e-9);
  });
});
