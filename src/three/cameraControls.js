import * as THREE from "three";
import { useStore } from "../store";
import { createHighlightHelpers } from "./cameraControls/highlights.js";
import { createExtrudeHelpers } from "./cameraControls/extrude.js";
import { createAnimateLoop } from "./cameraControls/animateLoop.js";
import { createSnapHelpers } from "./cameraControls/snap.js";
import { createSketchHoverHelpers } from "./cameraControls/sketchHover.js";
import { createNavigationHandlers } from "./cameraControls/navigation.js";
import { createTransformHandleDrag } from "./cameraControls/transformHandleDrag.js";
import { createViewInteraction } from "./cameraControls/viewInteraction.js";
import { createSketchInteraction } from "./cameraControls/sketchInteraction.js";

export function loadCameraState() {
  try {
    const saved = localStorage.getItem("cad-camera-state");
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.warn("Failed to load camera state:", e);
  }
  return {
    positionX: 10,
    positionY: 10,
    positionZ: 10,
    targetX: 0,
    targetY: 0,
    targetZ: 0,
  };
}

export function saveCameraState(cameraRef, targetRef, cameraControlsRef) {
  if (!cameraRef.current || !cameraControlsRef.current) return;
  try {
    localStorage.setItem(
      "cad-camera-state",
      JSON.stringify({
        positionX: cameraRef.current.position.x,
        positionY: cameraRef.current.position.y,
        positionZ: cameraRef.current.position.z,
        targetX: targetRef.current.x,
        targetY: targetRef.current.y,
        targetZ: targetRef.current.z,
        rotationX: cameraControlsRef.current.targetRotationX,
        rotationY: cameraControlsRef.current.targetRotationY,
      }),
    );
  } catch (e) {
    console.warn("Failed to save camera state:", e);
  }
}

export function getOrbitAnchor(
  cameraRef,
  targetRef,
  raycasterRef,
  sceneRef,
  objectsRef,
  itemsRef,
) {
  const cam = cameraRef.current;
  if (!cam) return targetRef.current.clone();
  sceneRef.current.updateMatrixWorld();
  raycasterRef.current.setFromCamera({ x: 0, y: 0 }, cam);
  const solidMeshes = Object.values(objectsRef.current).filter((m) => {
    if (!m.visible) return false;
    const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
    return it && it.type !== "sketch";
  });
  if (solidMeshes.length > 0) {
    const hits = raycasterRef.current.intersectObjects(solidMeshes, false);
    if (hits.length > 0) return hits[0].point.clone();
  }
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  if (raycasterRef.current.ray.intersectPlane(groundPlane, hit))
    return hit.clone();
  return targetRef.current.clone();
}

export function setOrbitAnchor(
  newTarget,
  cameraRef,
  targetRef,
  cameraControlsRef,
  orbitIndicator,
) {
  targetRef.current.copy(newTarget);
  const dp = new THREE.Vector3().subVectors(
    cameraRef.current.position,
    newTarget,
  );
  const dist = dp.length();
  cameraControlsRef.current.targetRotationX =
    dist > 0 ? Math.asin(Math.max(-1, Math.min(1, dp.y / dist))) : 0;
  cameraControlsRef.current.targetRotationY = Math.atan2(dp.x, dp.z);
  orbitIndicator.position.copy(newTarget);
  orbitIndicator.visible = true;
}

// ── Main event attachment ────────────────────────────────────────────────────

export function attachCameraControls(ctx) {
  const {
    renderer,
    scene,
    cameraRef,
    targetRef,
    raycasterRef,
    mouseRef,
    cameraControlsRef,
    objectsRef,
    itemsRef,
    handlesRef,
    handleDragRef,
    transformDebounceRef,
    boundingBoxRef,
    faceHighlightRef,
    edgeHighlightRef,
    pointHighlightRef,
    sketchModeRef,
    sketchDrawRef,
    sketchPlacementModeRef,
    sketchPlacementPlanesRef,
    activeSketchToolRef,
    selectedIdRef,
    selectedIdsRef,
    dimHintRef,
    cameraAnimRef,
    savedCameraStateRef,
    planeRef,
    axisGroupRef,
    sketchGridGroupRef,
    sketchShapesGroupRef,
    extrudeSelectGroupRef,
    extrudeSelectModeRef,
    orbitIndicator,
    gridMaterial,
    rulerGroup,
    composerRef,
    setRotationState,
    setHoveredId,
    selectItem,
    setSketchDrawPhase,
    sceneRef,
    propagateConstraintsRef,
  } = ctx;

  const controls = cameraControlsRef.current;
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);

  const save = () => saveCameraState(cameraRef, targetRef, cameraControlsRef);

  // ── Sketch drawing helpers ─────────────────────────────────────────────────

  const screenToSketchLocal = (screenX, screenY, sketchMesh) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
      sketchMesh.quaternion,
    );
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      normal,
      sketchMesh.position,
    );
    const worldPt = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, worldPt)) return null;
    const localPt = worldPt
      .clone()
      .sub(sketchMesh.position)
      .applyQuaternion(sketchMesh.quaternion.clone().invert());
    return { x: localPt.x, y: localPt.y };
  };

  // ── Snap helpers ──────────────────────────────────────────────────────────
  const { clearSnapIndicator, showSnapIndicator, findSnap, makePreviewLine2 } =
    createSnapHelpers({ scene, renderer, cameraRef });

  const pointInPolygon2D = (pt, polygon) => {
    const { x, y } = pt;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x,
        yi = polygon[i].y;
      const xj = polygon[j].x,
        yj = polygon[j].y;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
        inside = !inside;
    }
    return inside;
  };

  // Hit-test sketch Line2 objects with a wider click target than the visual linewidth.
  const SKETCH_HIT_PX = 12;
  const hitTestSketchLines = (ray, lineObjs) => {
    lineObjs.forEach((l) => {
      l.userData._lw = l.material.linewidth;
      l.material.linewidth = SKETCH_HIT_PX;
    });
    const hits = ray.intersectObjects(lineObjs, false);
    lineObjs.forEach((l) => {
      l.material.linewidth = l.userData._lw;
      delete l.userData._lw;
    });
    return hits;
  };

  // ── Sketch hover + constraint-selection visuals ───────────────────────────
  const {
    clearHoverLineHighlight,
    applyHoverLineHighlight,
    clearConstraintSelection,
    reapplyConstraintSelectionVisual,
    selectConstraint,
    getSelectedConstraintIdx,
    clearConstraintHoverHighlight,
    applyConstraintHoverHighlight,
    clearHoverPointIndicator,
    showHoverPointIndicator,
    updateSketchHover,
    clearAllSketchHover,
    POINT_LINE_COLOR,
  } = createSketchHoverHelpers(
    {
      scene,
      renderer,
      cameraRef,
      sketchShapesGroupRef,
      selectedIdRef,
      itemsRef,
      objectsRef,
      dimHintRef,
    },
    { findSnap, hitTestSketchLines },
  );

  // ── Highlight helpers ──────────────────────────────────────────────────────
  // Constructed BEFORE extrude because extrude depends on
  // clearFaceHighlight / applyFaceHighlight.

  const highlights = createHighlightHelpers({
    scene,
    faceHighlightRef,
    edgeHighlightRef,
    pointHighlightRef,
    itemsRef,
  });
  const {
    clearFaceHighlight,
    clearEdgeHighlight,
    clearPointHighlight,
    clearHL,
    applyFaceHighlight,
    applyEdgeHighlight,
    applyPointHighlight,
  } = highlights;

  // ── Extrude profile selection ─────────────────────────────────────────────

  // Shared screen→ray helper used by extrude AND by sketch-line picking
  // further down.  Kept here so a single definition is in scope for both
  // the extrude factory and the in-function sketch hover/click paths.
  const makeRay = (screenX, screenY) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    return ray;
  };

  const extrude = createExtrudeHelpers(
    {
      scene,
      renderer,
      cameraRef,
      objectsRef,
      itemsRef,
      extrudeSelectGroupRef,
    },
    {
      clearFaceHighlight,
      applyFaceHighlight,
      screenToSketchLocal,
      pointInPolygon2D,
      makeRay,
    },
  );
  const {
    rebuildPreviews,
    handleExtrudeHover,
    handleExtrudeProfileClick,
    preselectRetargetProfile,
    beginExtrudeStartPick,
    handleExtrudeStartHover,
    handleExtrudeStartClick,
    clearStartHighlight,
    finalizeExtrude,
    cancelExtrude,
  } = extrude;

  // Expose extrude-overlay control to the React layer:
  //   • finalizeExtrudeWithDepth(d)         — commit at numeric depth `d`.
  //   • finalizeExtrudeWithFormula(f, d)    — commit storing formula `f`
  //                                           and using its resolved depth
  //                                           `d` for the preview/profile.
  //   • updateExtrudePreview(d)             — re-render the live preview
  //                                           mesh at depth `d`.
  controls.finalizeExtrudeWithDepth = (depth) => finalizeExtrude(depth);
  controls.finalizeExtrudeWithFormula = (formula, depth) =>
    finalizeExtrude(depth, formula);
  controls.cancelExtrude = () => cancelExtrude();
  controls.updateExtrudePreview = (depth) => {
    if (!extrude.hasProfiles) return;
    // Preserve the sign so a negative (backward) depth previews in the -Z
    // direction; makeExtrudePreviewMesh clamps the magnitude to ≥ 0.05.
    rebuildPreviews(depth);
  };
  // Enter the "pick a face / sketch plane to offset the extrude start" mode.
  controls.beginExtrudeStartPick = () => beginExtrudeStartPick();
  // Extrude the selected solid face directly (the React extrude button calls
  // this when a face is selected).  Returns true if a face extrude started.
  controls.extrudeSelectedFace = () => extrude.startFaceExtrudeFromSelection();
  // Pre-select the original profile region when retargeting an extrude.
  controls.preselectRetargetProfile = () => preselectRetargetProfile();

  // The current view centre (camera orbit target) in world coords — the
  // toolbar reads this so a newly created primitive spawns where the user is
  // looking instead of always at the world origin.
  controls.getViewTarget = () => targetRef.current.clone();

  // Drop the selected non-sketch objects so their lowest world-Y point
  // sits on the ground plane (Y=0).  Computes the min Y across all
  // selected meshes' world-space bounding boxes, then dispatches a
  // single setItemsTransform with each item's new Y position.
  controls.dropSelectedToGround = () => {
    const store = useStore.getState();
    const selected = (
      store.selectedIds && store.selectedIds.length > 0
        ? store.selectedIds
        : store.selectedId != null
          ? [store.selectedId]
          : []
    )
      .map((id) => ({ id, item: store.items.find((i) => i.id === id) }))
      .filter(({ item }) => item && item.type !== "sketch");
    if (selected.length === 0) return;
    let minY = Infinity;
    const box = new THREE.Box3();
    for (const { id } of selected) {
      const mesh = objectsRef.current?.[id];
      if (!mesh) continue;
      mesh.updateMatrixWorld(true);
      box.setFromObject(mesh);
      if (Number.isFinite(box.min.y) && box.min.y < minY) minY = box.min.y;
    }
    if (!Number.isFinite(minY)) return;
    const shift = -minY;
    if (Math.abs(shift) < 1e-6) return;
    const updates = selected.map(({ id, item }) => ({
      id,
      position: {
        x: item.position?.x ?? 0,
        y: (item.position?.y ?? 0) + shift,
        z: item.position?.z ?? 0,
      },
    }));
    store.setItemsTransform(updates);
    // Persist as undoable history entries so the move survives a replay
    // / reload (setItemsTransform alone only touches `items`).
    for (const u of updates) {
      useStore.getState().recordTransformHistory(u.id, "Moved");
    }
  };

  // ── Transform-handle (gizmo) drag — 3D view mode ──────────────────────────
  const { tryBeginHandleDrag, updateHandleDrag, commitHandleDrag } =
    createTransformHandleDrag({
      renderer,
      cameraRef,
      objectsRef,
      itemsRef,
      handlesRef,
      handleDragRef,
      boundingBoxRef,
      transformDebounceRef,
      raycasterRef,
      selectedIdRef,
      cameraControlsRef,
    });

  // ── 3D view-mode pointer interaction (hover / select) ─────────────────────
  const { onViewHover, onViewMouseUp } = createViewInteraction(
    {
      renderer,
      cameraRef,
      mouseRef,
      raycasterRef,
      objectsRef,
      itemsRef,
      sketchModeRef,
      sketchPlacementModeRef,
      sketchPlacementPlanesRef,
      cameraControlsRef,
      orbitIndicator,
    },
    {
      setHoveredId,
      selectItem,
      save,
      highlights,
      applyFaceHighlight,
      clearFaceHighlight,
      applyEdgeHighlight,
      clearEdgeHighlight,
      applyPointHighlight,
      clearPointHighlight,
      isMac,
    },
  );

  // ── Sketch-mode interaction (selection / drag / draw / constraints) ───────
  const {
    onSketchMouseDown,
    onSketchMouseMove,
    onSketchMouseUp,
    onKeyDown,
    clearSketchVisualsFor3D,
    refreshSketchSelectionOverlay,
    unsubItems,
  } = createSketchInteraction(
    {
      scene,
      renderer,
      cameraRef,
      objectsRef,
      itemsRef,
      selectedIdRef,
      sketchModeRef,
      sketchShapesGroupRef,
      sketchDrawRef,
      activeSketchToolRef,
      dimHintRef,
      extrudeSelectModeRef,
      sketchPlacementModeRef,
      cameraControlsRef,
      propagateConstraintsRef,
    },
    {
      screenToSketchLocal,
      pointInPolygon2D,
      makeRay,
      hitTestSketchLines,
      clearSnapIndicator,
      showSnapIndicator,
      findSnap,
      makePreviewLine2,
      clearAllSketchHover,
      updateSketchHover,
      clearHoverLineHighlight,
      applyHoverLineHighlight,
      showHoverPointIndicator,
      clearHoverPointIndicator,
      POINT_LINE_COLOR,
      clearConstraintHoverHighlight,
      applyConstraintHoverHighlight,
      clearConstraintSelection,
      reapplyConstraintSelectionVisual,
      selectConstraint,
      getSelectedConstraintIdx,
      cancelExtrude,
      clearStartHighlight,
      setSketchDrawPhase,
      isMac,
    },
  );

  // Let React (the dimension-input overlay) re-anchor the green selection
  // highlight after a dimension edit moves the selected line.
  controls.refreshSketchSelectionOverlay = refreshSketchSelectionOverlay;

  // ── Mouse event handlers ───────────────────────────────────────────────────

  const onMouseDown = (e) => {
    if (e.button === 0) {
      if (extrudeSelectModeRef && extrudeSelectModeRef.current) {
        controls.mouseDownX = e.clientX;
        controls.mouseDownY = e.clientY;
        return;
      }
      if (onSketchMouseDown(e)) return;

      if (tryBeginHandleDrag(e)) return;
      controls.mouseDownX = e.clientX;
      controls.mouseDownY = e.clientY;
    } else if (e.button === 2) {
      if (!sketchModeRef.current) {
        controls.isRotating = true;
        setOrbitAnchor(
          getOrbitAnchor(
            cameraRef,
            targetRef,
            raycasterRef,
            sceneRef,
            objectsRef,
            itemsRef,
          ),
          cameraRef,
          targetRef,
          cameraControlsRef,
          orbitIndicator,
        );
      }
    }
  };

  const onMouseMove = (e) => {
    const currentCamera = cameraRef.current;
    if (!currentCamera) return;

    if (extrudeSelectModeRef && extrudeSelectModeRef.current) {
      if (extrudeSelectModeRef.current === "profile")
        handleExtrudeHover(e.clientX, e.clientY);
      else if (extrudeSelectModeRef.current === "start")
        handleExtrudeStartHover(e.clientX, e.clientY);
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
      return;
    }
    if (onSketchMouseMove(e)) return;

    clearSketchVisualsFor3D();

    if (updateHandleDrag(e)) return;

    onViewHover(e);
  };

  const onMouseUp = (e) => {
    if (
      extrudeSelectModeRef &&
      extrudeSelectModeRef.current &&
      e.button === 0
    ) {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5) {
        if (extrudeSelectModeRef.current === "profile")
          handleExtrudeProfileClick(e.clientX, e.clientY);
        else if (extrudeSelectModeRef.current === "start")
          handleExtrudeStartClick(e.clientX, e.clientY);
      }
      return;
    }

    if (onSketchMouseUp(e)) return;

    if (commitHandleDrag()) return;

    onViewMouseUp(e);
  };

  // ── Camera navigation (wheel + touch) ─────────────────────────────────────
  const {
    onMouseWheel,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    disposeNavigation,
  } = createNavigationHandlers(
    {
      cameraRef,
      targetRef,
      renderer,
      sketchModeRef,
      raycasterRef,
      sceneRef,
      objectsRef,
      itemsRef,
      cameraControlsRef,
      orbitIndicator,
    },
    { save, setRotationState, getOrbitAnchor, setOrbitAnchor, isMac },
  );

  // ── Keyboard ───────────────────────────────────────────────────────────────

  const onModifierUp = (e) => {
    // Modifier-up: hide the corresponding mode's hover highlight visual
    // so it doesn't linger.  Use clearHL (visual only) — NOT
    // clearEdgeHighlight / clearFaceHighlight — so that pendingEdge/
    // FaceSelection survives a momentary key release.  Otherwise a stray
    // keyup between hover and click (or natural keyup→click ordering on
    // some browsers) wipes the pending selection and the click falls
    // through to object mode.
    //   • CTRL/Cmd → edge mode (also part of point mode)
    //   • ALT      → face mode (also part of point mode)
    if (e.key === "Meta" || e.key === "Control") {
      clearHL(edgeHighlightRef);
      clearHL(pointHighlightRef);
    }
    if (e.key === "Alt") {
      clearHL(faceHighlightRef);
      clearHL(pointHighlightRef);
    }
  };

  // ── Animate loop ───────────────────────────────────────────────────────────

  const animateLoop = createAnimateLoop({
    scene,
    renderer,
    cameraRef,
    targetRef,
    cameraAnimRef,
    sketchModeRef,
    sketchGridGroupRef,
    sketchShapesGroupRef,
    sketchPlacementPlanesRef,
    objectsRef,
    selectedIdRef,
    axisGroupRef,
    handlesRef,
    boundingBoxRef,
    gridMaterial,
    rulerGroup,
    composerRef,
    setRotationState,
  });

  // ── Attach listeners ───────────────────────────────────────────────────────

  const el = renderer.domElement;
  el.addEventListener("mousedown", onMouseDown);
  el.addEventListener("mousemove", onMouseMove);
  el.addEventListener("mouseup", onMouseUp);
  el.addEventListener("wheel", onMouseWheel, { passive: false });
  const onContextMenu = (e) => e.preventDefault();
  el.addEventListener("contextmenu", onContextMenu);
  el.addEventListener("touchstart", onTouchStart, { passive: true });
  el.addEventListener("touchmove", onTouchMove, { passive: false });
  el.addEventListener("touchend", onTouchEnd);
  document.addEventListener("keyup", onModifierUp);
  document.addEventListener("keydown", onKeyDown);

  return () => {
    animateLoop.stop();
    disposeNavigation();
    el.removeEventListener("mousedown", onMouseDown);
    el.removeEventListener("mousemove", onMouseMove);
    el.removeEventListener("mouseup", onMouseUp);
    el.removeEventListener("wheel", onMouseWheel);
    el.removeEventListener("contextmenu", onContextMenu);
    el.removeEventListener("touchstart", onTouchStart);
    el.removeEventListener("touchmove", onTouchMove);
    el.removeEventListener("touchend", onTouchEnd);
    document.removeEventListener("keyup", onModifierUp);
    document.removeEventListener("keydown", onKeyDown);
    unsubItems();
  };
}
