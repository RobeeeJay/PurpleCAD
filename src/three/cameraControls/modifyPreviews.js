// Live previews for the 3D Modify tools (chamfer, push/pull, shell,
// simplify, convert, hole, emboss, texture, draft), the component-motion
// helpers and the point-to-point move preview.  Each attaches its update /
// clear pair onto the shared `controls` handle, which is how the React layer
// reaches them.

import * as THREE from "three";
import { useStore } from "../../store";
import { createChamferPreviewHelpers } from "./chamferPreview.js";
import { createComponentMotionHelpers } from "./componentMotionTool.js";
import { createPushPullPreviewHelpers } from "./pushPull.js";
import { createShellPreviewHelpers } from "./shell.js";
import { createSimplifyPreviewHelpers } from "./simplify.js";
import { createConvertPreviewHelpers } from "./convertSurfaces.js";
import { createHolePreviewHelpers } from "./hole.js";
import { createEmbossPreviewHelpers } from "./emboss.js";
import { createTexturePreviewHelpers } from "./texture.js";
import { createDraftPreviewHelpers } from "./draft.js";
import { faceDownPose, itemPose } from "../faceToGround.js";

// Returns the component-motion helpers, which the caller disposes.
export function attachModifyPreviews({
  controls,
  scene,
  cameraRef,
  itemsRef,
  objectsRef,
}) {
  // Live preview for ChamferOverlay: re-runs the chamfer/fillet recipe
  // against the current selectedSubGeometry + distance/angle and overlays
  // the result's outline as a wireframe.
  const chamferPreview = createChamferPreviewHelpers({
    scene,
    itemsRef,
    objectsRef,
  });
  controls.updateChamferPreview = (distanceMm, angleDeg) =>
    chamferPreview.updateChamferPreview(distanceMm, angleDeg);
  controls.clearChamferPreview = () => chamferPreview.clearChamferPreview();

  // Component motion: the dialog's reference pick and axis, and playing a
  // component's motion with collision checks.
  const componentMotion = createComponentMotionHelpers({
    scene,
    objectsRef,
    itemsRef,
    cameraRef,
  });
  controls.componentMotionState = () => componentMotion.inspect();

  // Live preview for PushPullOverlay: re-runs the push/pull recipe against the
  // current selectedSubGeometry faces + distance and overlays the result.
  const pushPullPreview = createPushPullPreviewHelpers({
    scene,
    itemsRef,
    objectsRef,
  });
  controls.updatePushPullPreview = (distanceMm) =>
    pushPullPreview.updatePushPullPreview(distanceMm);
  controls.updatePushPullEditPreview = (regenerator, distanceMm, itemId) =>
    pushPullPreview.updatePushPullEditPreview(regenerator, distanceMm, itemId);
  controls.clearPushPullPreview = () => pushPullPreview.clearPushPullPreview();

  const shellPreview = createShellPreviewHelpers({
    scene,
    itemsRef,
    objectsRef,
  });
  controls.updateShellPreview = (args) => shellPreview.updateShellPreview(args);
  controls.clearShellPreview = () => shellPreview.clearShellPreview();

  const simplifyPreview = createSimplifyPreviewHelpers({
    scene,
    itemsRef,
    objectsRef,
  });
  controls.updateSimplifyPreview = (args) =>
    simplifyPreview.updateSimplifyPreview(args);
  controls.clearSimplifyPreview = () => simplifyPreview.clearSimplifyPreview();

  const convertPreview = createConvertPreviewHelpers({
    scene,
    itemsRef,
    objectsRef,
  });
  controls.updateConvertPreview = (args) =>
    convertPreview.updateConvertPreview(args);
  controls.clearConvertPreview = () => convertPreview.clearConvertPreview();

  const holePreview = createHolePreviewHelpers({ scene, itemsRef, objectsRef });
  controls.updateHolePreview = () => holePreview.updateHolePreview();
  controls.clearHolePreview = () => holePreview.clearHolePreview();
  const embossPreview = createEmbossPreviewHelpers({
    scene,
    itemsRef,
    objectsRef,
  });
  controls.updateEmbossPreview = () => embossPreview.updateEmbossPreview();
  controls.clearEmbossPreview = () => embossPreview.clearEmbossPreview();
  const texturePreview = createTexturePreviewHelpers({
    scene,
    itemsRef,
    objectsRef,
  });
  controls.updateTexturePreview = () => texturePreview.updateTexturePreview();
  controls.clearTexturePreview = () => texturePreview.clearTexturePreview();
  const draftPreview = createDraftPreviewHelpers({
    scene,
    itemsRef,
    objectsRef,
  });
  controls.updateDraftPreview = () => draftPreview.updateDraftPreview();
  controls.clearDraftPreview = () => draftPreview.clearDraftPreview();

  // Point-to-Point move: preview by sliding the REAL mesh to its target spot
  // (A's position + (B - A)) once both points are picked, restoring it on
  // cancel.  Moving the real mesh (rather than a clone) is what makes primitives
  // preview correctly — sphere/cylinder/torus are raymarched by a shader on a box
  // hull, so a plain-material clone of mesh.geometry would draw the box, not the
  // shape.  The commit then moves it for real via the store.
  let ptpMoved = null; // { mesh, pos: Vector3 }
  controls.clearPointToPointPreview = () => {
    if (!ptpMoved) return;
    if (ptpMoved.mesh.parent) ptpMoved.mesh.position.copy(ptpMoved.pos);
    ptpMoved = null;
  };
  controls.updatePointToPointPreview = () => {
    controls.clearPointToPointPreview();
    const t = useStore.getState().pointToPointTool;
    if (!t || !t.a || !t.b) return;
    const mesh = objectsRef.current[t.a.itemId];
    if (!mesh) return;
    ptpMoved = { mesh, pos: mesh.position.clone() };
    mesh.position.add(
      new THREE.Vector3(
        t.b.point.x - t.a.point.x,
        t.b.point.y - t.a.point.y,
        t.b.point.z - t.a.point.z,
      ),
    );
  };

  // Drop to ground on a face: preview by posing the real mesh, as Point to
  // Point does.  The pose is always worked out from the rest pose, so the
  // preview is undone first.
  let ftgMoved = null; // { mesh, pos: Vector3, quat: Quaternion }
  controls.clearFaceToGroundPreview = () => {
    if (!ftgMoved) return;
    if (ftgMoved.mesh.parent) {
      ftgMoved.mesh.position.copy(ftgMoved.pos);
      ftgMoved.mesh.quaternion.copy(ftgMoved.quat);
    }
    ftgMoved = null;
  };
  const faceToGroundMeshPose = () => {
    const face = useStore.getState().faceToGroundTool?.face;
    const mesh = face && objectsRef.current[face.itemId];
    if (!mesh) return null;
    const v = (p) => new THREE.Vector3(p.x, p.y, p.z);
    return { mesh, ...faceDownPose(mesh, v(face.normal), v(face.point)) };
  };
  controls.updateFaceToGroundPreview = () => {
    controls.clearFaceToGroundPreview();
    const pose = faceToGroundMeshPose();
    if (!pose) return;
    const { mesh } = pose;
    ftgMoved = {
      mesh,
      pos: mesh.position.clone(),
      quat: mesh.quaternion.clone(),
    };
    mesh.position.copy(pose.position);
    mesh.quaternion.copy(pose.quaternion);
  };
  // The item position and rotation that lay the picked face on the ground.
  controls.faceToGroundItemPose = () => {
    controls.clearFaceToGroundPreview();
    const pose = faceToGroundMeshPose();
    if (!pose) return null;
    return itemPose(
      pose.position,
      pose.quaternion,
      pose.mesh.userData.extrudeLocalOffset,
    );
  };

  return componentMotion;
}
