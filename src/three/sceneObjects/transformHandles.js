// Builds the rotation tori + axis sphere handles + the bounding-box
// frame and dimension sprites used by the transform-edit gizmo.

import * as THREE from "three";
import {
  HANDLE_CONFIGS,
  MM_PER_UNIT,
  getObjectDimensions,
  getObjectExtent,
  makeDimSprite,
  placeDimLabels,
} from "./dimensions.js";

export function buildTransformHandles(selectedId, items, objectsRef) {
  const mesh = objectsRef.current[selectedId];
  if (!mesh) return null;
  const item = items.find((i) => i.id === selectedId);
  if (!item || item.type === "sketch") return null;

  const handles = [];
  const ext = getObjectExtent(item.type, mesh.scale.x);

  HANDLE_CONFIGS.forEach(({ type, color, dir }) => {
    const geo = new THREE.SphereGeometry(0.12, 10, 10);
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    const hMesh = new THREE.Mesh(geo, mat);
    hMesh.renderOrder = 999;
    hMesh.userData.isHandle = true;
    hMesh.position.copy(mesh.position).addScaledVector(dir, ext + 0.5);
    handles.push({ mesh: hMesh, type, dir: dir.clone() });
  });

  const torusRadius = ext + 0.85;
  [
    { type: "rotX", color: 0xff4444, rx: 0, ry: Math.PI / 2, rz: 0 },
    { type: "rotY", color: 0x4488ff, rx: Math.PI / 2, ry: 0, rz: 0 },
    { type: "rotZ", color: 0x44ff44, rx: 0, ry: 0, rz: 0 },
  ].forEach(({ type, color, rx, ry, rz }) => {
    const geo = new THREE.TorusGeometry(torusRadius, 0.045, 6, 64);
    const mat = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const torus = new THREE.Mesh(geo, mat);
    torus.renderOrder = 998;
    torus.userData.isHandle = true;
    torus.position.copy(mesh.position);
    torus.rotation.set(rx, ry, rz);
    handles.push({ mesh: torus, type, dir: null });
  });

  const dim = getObjectDimensions(item.type, mesh.scale.x);
  const boxMesh = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({
      color: 0x88ccff,
      depthTest: false,
      transparent: true,
      opacity: 0.7,
    }),
  );
  boxMesh.renderOrder = 998;
  boxMesh.scale.set(dim.w, dim.h, dim.d);
  boxMesh.position.copy(mesh.position);

  const mmX = Math.round(dim.w * MM_PER_UNIT);
  const mmY = Math.round(dim.h * MM_PER_UNIT);
  const mmZ = Math.round(dim.d * MM_PER_UNIT);
  const labelX = makeDimSprite(mmX + "mm", "#ff4444");
  const labelY = makeDimSprite(mmY + "mm", "#4488ff");
  const labelZ = makeDimSprite(mmZ + "mm", "#44ff44");

  const boundingBox = { boxMesh, labelX, labelY, labelZ };
  placeDimLabels(boundingBox, mesh.position, dim);

  return { handles, boundingBox };
}
