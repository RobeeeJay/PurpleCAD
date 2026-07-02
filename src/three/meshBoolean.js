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

// A bbox-centred geometryData + the world centre from an evaluated Brush, so the
// result mesh sits where it was computed.  Returns null when empty.
function brushToResult(brush) {
  const geom = brush.geometry;
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

const makeEvaluator = () => {
  const e = new Evaluator();
  e.useGroups = false;
  e.attributes = ["position"];
  return e;
};

// Boolean the given world-space scene meshes (in order) and return a bbox-
// centred geometryData + the world centre.  Returns null when it can't run.
export function meshBoolean(meshes, operation) {
  const op = OP[operation];
  if (op == null || !meshes || meshes.length < 2) return null;
  const evaluator = makeEvaluator();
  let acc = brushFromMesh(meshes[0]);
  for (let i = 1; i < meshes.length; i++) {
    acc = evaluator.evaluate(acc, brushFromMesh(meshes[i]), op);
  }
  return brushToResult(acc);
}

// A half-space box Brush whose -Z face lies on the plane and which extends along
// the plane's +normal (matches occOps.js#splitItem's cutting box).
function halfSpaceBox(plane, S) {
  const g = new THREE.BoxGeometry(2 * S, 2 * S, 2 * S);
  g.translate(0, 0, S); // -Z face on z=0, body spans +Z
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(plane.position.x, plane.position.y, plane.position.z),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        plane.rotation.x || 0,
        plane.rotation.y || 0,
        plane.rotation.z || 0,
      ),
    ),
    new THREE.Vector3(1, 1, 1),
  );
  g.applyMatrix4(m);
  const ng = new THREE.BufferGeometry();
  ng.setAttribute("position", g.getAttribute("position"));
  if (g.index) ng.setIndex(g.index);
  g.dispose();
  const b = new Brush(ng);
  b.updateMatrixWorld(true);
  return b;
}

// Split a world-space scene mesh into two parts along a plane (renderer-side, via
// three-bvh-csg) — the fallback when OCC can't rebuild the target as a solid.
// partA is the +normal side (box intersection), partB the -normal side.
export function meshSplit(mesh, plane) {
  if (!mesh) return null;
  const S = 1000;
  const aBrush = makeEvaluator().evaluate(
    brushFromMesh(mesh),
    halfSpaceBox(plane, S),
    INTERSECTION,
  );
  const bBrush = makeEvaluator().evaluate(
    brushFromMesh(mesh),
    halfSpaceBox(plane, S),
    SUBTRACTION,
  );
  const partA = brushToResult(aBrush);
  const partB = brushToResult(bBrush);
  if (!partA && !partB) return null;
  return { partA, partB };
}
