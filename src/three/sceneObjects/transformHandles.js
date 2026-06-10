// Builds the rotation tori + axis sphere handles + the bounding-box
// frame and dimension sprites used by the transform-edit gizmo.

import * as THREE from "three";
import {
  HANDLE_CONFIGS,
  MM_PER_UNIT,
  getMeshDimensions,
  getMeshBBoxCenter,
  makeDimSprite,
  placeDimLabels,
} from "./dimensions.js";
import {
  AXIS_X_COLOR,
  AXIS_Y_COLOR,
  AXIS_Z_COLOR,
  FACE_HOVER_COLOR,
  toCssHex,
} from "../theme.js";

// Fixed gizmo radius (scene units), used for the ring radius (ext + 0.85) and
// the axis/scale handle offset (ext + 0.5).  Object-size-independent so the
// widget doesn't grow/shrink as the object is resized.
const GIZMO_EXT = 1.0;

export function buildTransformHandles(selectedId, items, objectsRef) {
  const mesh = objectsRef.current[selectedId];
  if (!mesh) return null;
  const item = items.find((i) => i.id === selectedId);
  if (!item || item.type === "sketch") return null;

  const handles = [];
  // Fixed gizmo radius (scene units) so the rotation/resize/drag widget stays
  // a constant on-screen size regardless of how large the object is or how it
  // is resized.  (It is still scaled per-frame for zoom + the GIZMO_SCALE
  // factor in animateLoop.)  Only its CENTRE tracks the object.
  const ext = GIZMO_EXT;
  // Centre the gizmo on the object's real bounding box so it sits on geometry
  // that isn't centred on the mesh origin (e.g. extrudes).
  const center = getMeshBBoxCenter(mesh);

  // `transparent: true` is REQUIRED (alongside depthTest:false +
  // renderOrder) so the gizmo lands in three.js's transparent render
  // queue.  In Transparent render mode every solid mesh becomes
  // `transparent: true`, and three.js renders the ENTIRE opaque queue
  // before the transparent queue — so an opaque handle (the default
  // for MeshBasicMaterial) draws BEFORE the transparent solid and gets
  // overdrawn by it.  Marking the handle transparent puts it in the
  // same queue, where its renderOrder (998/999) keeps it on top.
  HANDLE_CONFIGS.forEach(({ type, color, dir }) => {
    const geo = new THREE.SphereGeometry(0.24, 12, 12);
    const mat = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
    });
    const hMesh = new THREE.Mesh(geo, mat);
    hMesh.renderOrder = 999;
    hMesh.userData.isHandle = true;
    // Authored offset distance from the gizmo centre.  The per-frame scaler
    // multiplies this by the on-screen-size factor so the handles ride on the
    // (also-scaled) rotation rings at every zoom instead of drifting off them.
    hMesh.userData.baseOffsetDist = ext + 0.5;
    hMesh.position.copy(center).addScaledVector(dir, ext + 0.5);
    handles.push({ mesh: hMesh, type, dir: dir.clone() });
  });

  const torusRadius = ext + 0.85;
  [
    { type: "rotX", color: AXIS_X_COLOR, rx: 0, ry: Math.PI / 2, rz: 0 },
    { type: "rotY", color: AXIS_Y_COLOR, rx: Math.PI / 2, ry: 0, rz: 0 },
    { type: "rotZ", color: AXIS_Z_COLOR, rx: 0, ry: 0, rz: 0 },
  ].forEach(({ type, color, rx, ry, rz }) => {
    const geo = new THREE.TorusGeometry(torusRadius, 0.09, 8, 64);
    const mat = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const torus = new THREE.Mesh(geo, mat);
    torus.renderOrder = 998;
    torus.userData.isHandle = true;
    torus.position.copy(center);
    torus.rotation.set(rx, ry, rz);
    handles.push({ mesh: torus, type, dir: null });
  });

  const dim = getMeshDimensions(mesh);
  const boxMesh = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({
      color: FACE_HOVER_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.7,
    }),
  );
  boxMesh.renderOrder = 998;
  boxMesh.scale.set(dim.w, dim.h, dim.d);
  boxMesh.position.copy(center);

  const mmX = Math.round(dim.w * MM_PER_UNIT);
  const mmY = Math.round(dim.h * MM_PER_UNIT);
  const mmZ = Math.round(dim.d * MM_PER_UNIT);
  const labelX = makeDimSprite(mmX + "mm", toCssHex(AXIS_X_COLOR));
  const labelY = makeDimSprite(mmY + "mm", toCssHex(AXIS_Y_COLOR));
  const labelZ = makeDimSprite(mmZ + "mm", toCssHex(AXIS_Z_COLOR));

  const boundingBox = { boxMesh, labelX, labelY, labelZ };
  placeDimLabels(boundingBox, center, dim);

  return { handles, boundingBox };
}
