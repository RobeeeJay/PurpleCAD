// Triangle-mesh boolean (three-bvh-csg) for operations that involve an imported
// mesh.  OCC booleans on a dense mesh-derived solid are pathologically slow and
// freeze the main process, so when an imported mesh is one of the operands we
// boolean the live triangle meshes directly here in the renderer instead.

import * as THREE from "three";
import {
  Evaluator,
  Brush,
  ADDITION,
  SUBTRACTION,
  INTERSECTION,
} from "three-bvh-csg";

const OP = {
  union: ADDITION,
  difference: SUBTRACTION,
  intersection: INTERSECTION,
};

// Build a position-only Brush from a scene mesh, baking its world transform in
// (so both operands share the exact same attribute set the Evaluator requires).
function brushFromMesh(mesh) {
  const src = mesh.geometry.clone();
  src.applyMatrix4(mesh.matrixWorld);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", src.getAttribute("position"));
  if (src.index) g.setIndex(src.index);
  src.dispose();
  const b = new Brush(g);
  b.updateMatrixWorld(true);
  return b;
}

// Boolean the given world-space scene meshes (in order) and return a bbox-
// centred geometryData + the world centre (so the result mesh sits where it was
// computed).  Returns null when it can't run.
export function meshBoolean(meshes, operation) {
  const op = OP[operation];
  if (op == null || !meshes || meshes.length < 2) return null;

  const evaluator = new Evaluator();
  evaluator.useGroups = false;
  evaluator.attributes = ["position"];

  let acc = brushFromMesh(meshes[0]);
  for (let i = 1; i < meshes.length; i++) {
    acc = evaluator.evaluate(acc, brushFromMesh(meshes[i]), op);
  }

  const geom = acc.geometry;
  const pos = geom.getAttribute("position");
  if (!pos || pos.count === 0) return null;
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  const cx = (bb.min.x + bb.max.x) / 2,
    cy = (bb.min.y + bb.max.y) / 2,
    cz = (bb.min.z + bb.max.z) / 2;

  const positions = new Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    positions[i * 3] = pos.getX(i) - cx;
    positions[i * 3 + 1] = pos.getY(i) - cy;
    positions[i * 3 + 2] = pos.getZ(i) - cz;
  }
  const indices = geom.index ? Array.from(geom.index.array) : null;

  return {
    geometryData: { positions, normals: null, indices },
    position: { x: cx, y: cy, z: cz },
  };
}
