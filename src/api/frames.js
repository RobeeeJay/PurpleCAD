// Units and frames at the agent API's boundary.
//
// Everything an agent sends or receives is millimetres in the USER's Z-up
// frame -- the one the transform panel and the exports use. Inside, the scene
// is three.js Y-up in scene units of mm / MM_PER_UNIT. Getting either wrong is
// silent: a part comes out ten times too big, or lying on its side. So the
// conversions live here, once, and nothing else in src/api does them.

import * as THREE from "three";
import { MM_PER_UNIT } from "../three/sceneObjects/dimensions.js";

export const toScene = (mm) => mm / MM_PER_UNIT;
export const toMm = (units) => units * MM_PER_UNIT;

// User (X, Y, Z) = internal (x, -z, y) -- the table in utils/axisDisplay.js.
export const internalToUser = ([x, y, z]) => [x, -z, y];
export const userToInternal = ([X, Y, Z]) => [X, Z, -Y];

// Sketch planes, named in the user frame. `u` and `v` are the user axes a
// sketch's local x and y land on; `normal` is the user-frame direction an
// extrude from the plane grows.
export const PLANES = {
  XY: {
    rotation: { x: -Math.PI / 2, y: 0, z: 0 },
    u: "X",
    v: "Y",
    normal: [0, 0, 1],
  },
  XZ: { rotation: { x: 0, y: 0, z: 0 }, u: "X", v: "Z", normal: [0, -1, 0] },
  YZ: {
    rotation: { x: 0, y: Math.PI / 2, z: 0 },
    u: "Y",
    v: "Z",
    normal: [1, 0, 0],
  },
};

// Where a sketch item on `plane` sits, offset along the plane's normal by mm.
export function planePlacement(plane, offsetMm = 0) {
  const { rotation, normal } = PLANES[plane];
  const [x, y, z] = userToInternal(normal.map((c) => toScene(c * offsetMm)));
  return { position: { x, y, z }, rotation: { ...rotation } };
}

// A sketch-local point, in scene units, as a user-frame position in mm.
export function sketchLocalToUserMm({ position, rotation }, lx, ly) {
  const v = new THREE.Vector3(lx, ly, 0).applyEuler(
    new THREE.Euler(rotation.x, rotation.y, rotation.z),
  );
  return internalToUser([
    v.x + position.x,
    v.y + position.y,
    v.z + position.z,
  ]).map(toMm);
}

const round = (v) => Math.round(v * 1000) / 1000;

// Bounding box and enclosed volume of a triangle surface under a world matrix,
// reported in the user frame in mm. The volume is what tells an agent a body
// is solid: an open or inside-out surface comes back near zero or negative.
export function meshStats({ positions, indices, matrix }) {
  const m = new THREE.Matrix4().fromArray(matrix);
  const vertexCount = positions.length / 3;
  const world = new Float64Array(positions.length);
  const v = new THREE.Vector3();
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vertexCount; i++) {
    v.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    v.applyMatrix4(m);
    world[i * 3] = v.x;
    world[i * 3 + 1] = v.y;
    world[i * 3 + 2] = v.z;
    lo[0] = Math.min(lo[0], v.x);
    lo[1] = Math.min(lo[1], v.y);
    lo[2] = Math.min(lo[2], v.z);
    hi[0] = Math.max(hi[0], v.x);
    hi[1] = Math.max(hi[1], v.y);
    hi[2] = Math.max(hi[2], v.z);
  }
  const triangles = indices ? indices.length / 3 : vertexCount / 3;
  let volume = 0;
  for (let t = 0; t < triangles; t++) {
    const [a, b, c] = [0, 1, 2].map(
      (k) => (indices ? indices[t * 3 + k] : t * 3 + k) * 3,
    );
    const [ax, ay, az] = [world[a], world[a + 1], world[a + 2]];
    const [bx, by, bz] = [world[b], world[b + 1], world[b + 2]];
    const [cx, cy, cz] = [world[c], world[c + 1], world[c + 2]];
    volume +=
      (ax * (by * cz - bz * cy) -
        ay * (bx * cz - bz * cx) +
        az * (bx * cy - by * cx)) /
      6;
  }
  // Internal y becomes user Z, and internal z becomes user -Y, so the Y range
  // flips end for end on the way out.
  const min = [lo[0], -hi[2], lo[1]].map((c) => round(toMm(c)));
  const max = [hi[0], -lo[2], hi[1]].map((c) => round(toMm(c)));
  return {
    min,
    max,
    size: max.map((c, i) => round(c - min[i])),
    volumeMm3: round(volume * MM_PER_UNIT ** 3),
    triangles,
  };
}
