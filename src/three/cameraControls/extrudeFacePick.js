// Picking a face for the extrude dialog: "Start from…" (where the prism begins)
// and "To…" (where it ends -- fills in the distance).  Split out of extrude.js,
// which owns the profile list and the preview prisms and passes them in.

import * as THREE from "three";
import { useStore } from "../../store";
import { MM_PER_UNIT } from "../sceneObjects.js";
import { EXTRUDE_FACE_HIGHLIGHT_ALT } from "../theme.js";

// The extrude distance that ends the prism on a picked point: its signed
// distance along the extrude normal from the profile plane, less the start
// offset.  For a face parallel to the profile the distance is taken from a
// corner of the clicked triangle instead of the raycast's hit point, which
// sits a float32 hair off the face -- the prism must end ON the face, or a
// later boolean against it grazes it inside OCC's tolerances (the split bug
// on mms2_base).  All vectors are world-space THREE.Vector3s.
export function distanceToFace({
  origin,
  normal,
  startOffset,
  point,
  faceNormal,
  faceCorner,
}) {
  const parallel =
    faceNormal && faceCorner && Math.abs(faceNormal.dot(normal)) > 1 - 1e-9;
  const on = parallel ? faceCorner : point;
  return on.clone().sub(origin).dot(normal) - (startOffset ?? 0);
}

export function createExtrudeFacePick({
  renderer,
  objectsRef,
  itemsRef,
  extrudeSelectGroupRef,
  makeRay,
  applyFaceHighlight,
  clearFaceHighlight,
  getProfiles,
  setStartSolidId,
  rebuildPreviews,
  defaultDepth,
}) {
  // Solid faces are the meaningful offset targets.  They're tested BEFORE the
  // sketch-region fills because those fills are invisible (opacity 0) yet still
  // raycastable, and they sit right on the sketch plane — when you sketch on an
  // object's face the fill is coincident with that face and would otherwise
  // intercept every ray, so the face under the cursor never lights up.
  // Mirror the Alt/Option face-pick target set (onViewHover faceMode): every
  // visible non-sketch mesh.  Crucially this INCLUDES extrude / csg solids —
  // those are exactly the bodies you want to start an offset from, and
  // excluding them was why their faces couldn't be picked.
  const solidStartTargets = () =>
    Object.values(objectsRef.current).filter((m) => {
      if (m.visible === false) return false;
      const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
      return it && it.type !== "sketch";
    });

  // The picked point + whether it was a face (vs a sketch-plane fill).  Faces
  // win; a fill is only used when no solid face is under the cursor.
  const startPickHit = (ray) => {
    const solidHits = ray.intersectObjects(solidStartTargets(), false);
    if (solidHits.length > 0) return { hit: solidHits[0], isFace: true };
    const fills = extrudeSelectGroupRef?.current?.children ?? [];
    const fillHits = fills.length ? ray.intersectObjects(fills, false) : [];
    if (fillHits.length > 0) return { hit: fillHits[0], isFace: false };
    return null;
  };

  // Both picks measure from the selected profile's plane, so a profile must
  // exist first — otherwise there's nothing to measure from and face clicks
  // would no-op (origin/normal still null).
  const beginPick = (mode) => {
    if (!getProfiles().length) {
      useStore
        .getState()
        .showNotification?.("Select geometry to extrude first");
      return;
    }
    useStore.getState().setExtrudeSelectMode(mode);
    renderer.domElement.style.cursor = "crosshair";
  };
  const beginExtrudeStartPick = () => beginPick("start");
  const beginExtrudeToPick = () => beginPick("to");

  // Clear any transient start-pick highlight (fill opacity + face overlay).
  const clearStartHighlight = () => {
    const fills = extrudeSelectGroupRef?.current?.children ?? [];
    fills.forEach((m) => {
      m.material.opacity = 0;
    });
    clearFaceHighlight();
  };

  const handleExtrudeStartHover = (screenX, screenY) => {
    clearStartHighlight();
    const picked = startPickHit(makeRay(screenX, screenY));
    if (!picked) {
      renderer.domElement.style.cursor = "crosshair";
      return;
    }
    // Light up the surface under the cursor so the user sees what the extrude
    // will start from (or reach): the face-overlay highlight for a solid face,
    // a translucent fill for a sketch plane.
    if (picked.isFace)
      applyFaceHighlight(picked.hit, EXTRUDE_FACE_HIGHLIGHT_ALT);
    else picked.hit.object.material.opacity = 0.3;
    renderer.domElement.style.cursor = "pointer";
  };

  // The clicked triangle's world normal and one world corner, for a pick on a
  // solid face.  Null for a sketch-plane fill.
  const faceOf = (picked) => {
    const { hit } = picked;
    if (!picked.isFace || !hit.face) return {};
    const pos = hit.object.geometry.attributes.position;
    const faceCorner = new THREE.Vector3()
      .fromBufferAttribute(pos, hit.face.a)
      .applyMatrix4(hit.object.matrixWorld);
    const faceNormal = hit.face.normal
      .clone()
      .applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld))
      .normalize();
    return { faceCorner, faceNormal };
  };

  // "Start from…" slides the prism's base to the picked surface; "To…" sets
  // the distance so its far end lands on it.
  const handleExtrudeStartClick = (screenX, screenY) => {
    // Measure from the (live) first profile's plane, so it's correct even if
    // the cached origin/normal lag the selection.
    const primary = getProfiles()[0];
    if (!primary) return;
    const picked = startPickHit(makeRay(screenX, screenY));
    if (!picked) return;
    clearStartHighlight();
    const origin = new THREE.Vector3(
      primary.position.x,
      primary.position.y,
      primary.position.z,
    );
    const normal = new THREE.Vector3(
      primary.normalWorld.x,
      primary.normalWorld.y,
      primary.normalWorld.z,
    );
    const store = useStore.getState();
    const current = store.extrudeDepthInput || {};
    if (store.extrudeSelectMode === "to") {
      const depth = distanceToFace({
        origin,
        normal,
        startOffset: current.startOffset,
        point: picked.hit.point,
        ...faceOf(picked),
      });
      store.setExtrudeSelectMode("profile");
      renderer.domElement.style.cursor = "crosshair";
      if (Math.abs(depth) < 1e-9) {
        store.showNotification?.(
          "That face is where the extrude starts — pick one further along.",
        );
        return;
      }
      // Shown and stored like a typed distance, in mm; kept to a millionth of
      // a millimetre so the prism still ends on the face.
      store.setExtrudeDepthInput({
        ...current,
        formula: String(Number((depth * MM_PER_UNIT).toFixed(6))),
        currentDepth: depth,
      });
      rebuildPreviews(depth);
      return;
    }
    const offset = picked.hit.point.clone().sub(origin).dot(normal);
    // Remember the solid the start was taken from so the extrude fuses into it.
    setStartSolidId(
      picked.isFace ? (picked.hit.object.userData.itemId ?? null) : null,
    );
    // Clear any typed offset buffer so the Offset field reflects the picked
    // face distance rather than a stale formula the user typed earlier.
    store.setExtrudeDepthInput({
      ...current,
      startOffset: offset,
      offsetFormula: undefined,
    });
    store.setExtrudeSelectMode("profile");
    rebuildPreviews(
      current.currentDepth ?? current.defaultDepth ?? defaultDepth,
    );
    renderer.domElement.style.cursor = "crosshair";
  };

  return {
    beginExtrudeStartPick,
    beginExtrudeToPick,
    clearStartHighlight,
    handleExtrudeStartHover,
    handleExtrudeStartClick,
  };
}
