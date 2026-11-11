import * as THREE from "three";
// Patches Mesh.raycast with a cached BVH for large meshes (fastRaycast.js).
import "./fastRaycast.js";
import { useStore } from "../store";
import { createHighlightHelpers } from "./cameraControls/highlights.js";
import { createExtrudeHelpers } from "./cameraControls/extrude.js";
import { createSweepHelpers } from "./cameraControls/sweep.js";
import { attachModifyPreviews } from "./cameraControls/modifyPreviews.js";
import { attachSceneQueries } from "./cameraControls/sceneQueries.js";
import { meshSplit } from "./meshSplit.js";
import { bboxCenterOf, massCentroidOf } from "./objectOrigin.js";
import { getCamera, saveCamera } from "../store/db.js";
import {
  createAnimateLoop,
  requestRender,
} from "./cameraControls/animateLoop.js";
import { createSnapHelpers } from "./cameraControls/snap.js";
import { createSketchHoverHelpers } from "./cameraControls/sketchHover.js";
import { createNavigationHandlers } from "./cameraControls/navigation.js";
import { createTransformHandleDrag } from "./cameraControls/transformHandleDrag.js";
import { createViewInteraction } from "./cameraControls/viewInteraction.js";
import { createEmbossInteraction } from "./cameraControls/embossPick.js";
import { createSketchInteraction } from "./cameraControls/sketchInteraction.js";
import { attachTouchInput } from "./cameraControls/touchInput.js";
import { createMouseNavigation } from "./cameraControls/mouseNavigation.js";
import { createToolPreviews } from "./cameraControls/toolPreviews.js";
import { createMeasureAndPrimitivePreviews } from "./cameraControls/measurePrimitivePreviews.js";
import { createMaterialAndFitHelpers } from "./cameraControls/materialFitHelpers.js";

export function loadCameraState() {
  try {
    const saved = getCamera();
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
    saveCamera(
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

// Width (px) of the objects/timeline overlay that floats over the LEFT of the
// canvas.  Matches useViewportCamera.js's own copy (duplicated rather than
// shared — see that file's comment) so the orbit pivot centres in the same
// visible region Home frames into, not the canvas centre hidden behind the
// panel.
const LEFT_PANEL_PX = 250;

export function getOrbitAnchor(
  cameraRef,
  targetRef,
  raycasterRef,
  sceneRef,
  objectsRef,
  itemsRef,
  renderer,
) {
  const cam = cameraRef.current;
  if (!cam) return targetRef.current.clone();
  sceneRef.current.updateMatrixWorld();
  // Ray through the centre of the VISIBLE 3D area (the canvas minus the left
  // panel), not the raw canvas centre — otherwise the pivot (and the ring
  // marking it) sits left of where the model is actually framed.
  const canvasW = renderer?.domElement?.clientWidth || 1;
  const panel = Math.min(LEFT_PANEL_PX, canvasW * 0.8);
  const ndcX = panel / canvasW;
  raycasterRef.current.setFromCamera({ x: ndcX, y: 0 }, cam);
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
    sweepSelectModeRef,
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

  // True while a camera tween (Home, orientation change, sketch fly-in) is
  // still running.  e2e needs this: the tweens advance per FRAME, so a fixed
  // wall-clock wait lands mid-flight wherever the frame rate happens to put
  // it -- under software rendering that is a different camera pose entirely.
  controls.isCameraAnimating = () => !!cameraAnimRef.current;

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
    highlightWorldPoint,
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
    handleExtrudeProfileBox,
    showExtrudeMarquee,
    clearExtrudeMarquee,
    preselectRetargetProfile,
    beginExtrudeStartPick,
    handleExtrudeStartHover,
    handleExtrudeStartClick,
    clearStartHighlight,
    finalizeExtrude,
    cancelExtrude,
  } = extrude;

  const {
    handleEmbossHover,
    handleEmbossClick,
    syncEmbossFills,
    handleTextureHover,
    handleTextureClick,
    handleStressHover,
    handleStressClick,
  } = createEmbossInteraction({
    renderer,
    raycasterRef,
    cameraRef,
    mouseRef,
    objectsRef,
    itemsRef,
    extrudeSelectGroupRef,
    screenToSketchLocal,
    pointInPolygon2D,
    highlights,
  });
  controls.syncEmbossFills = syncEmbossFills;
  // Clear the persistent multi-face selection highlight (on tool cancel/confirm).
  controls.clearEmbossSelectedFaces = () => highlights.clearSelectedFaces();

  createMeasureAndPrimitivePreviews({
    controls,
    scene,
    itemsRef,
    objectsRef,
    extrude,
    beginExtrudeStartPick,
    cancelExtrude,
    finalizeExtrude,
    preselectRetargetProfile,
    rebuildPreviews,
  });

  const componentMotion = attachModifyPreviews({
    controls,
    scene,
    cameraRef,
    itemsRef,
    objectsRef,
  });

  // Sweep tools (Revolve / Pipe / Loft): profile + axis picking, live preview,
  // and the Confirm-time commit.  The SweepOverlay drives them via these.
  const sweep = createSweepHelpers({
    scene,
    renderer,
    cameraRef,
    objectsRef,
    itemsRef,
    extrudeSelectGroupRef,
  });
  const { handleSweepHover, handleSweepClick } = sweep;
  controls.updateSweepPreview = () => sweep.updateSweepPreview();

  // Change-origin (centre of mass / centre of object): compute the pivot from
  // the live mesh geometry in its LOCAL frame and store it as item.origin.
  controls.applyObjectOrigin = (itemId, mode) => {
    const mesh = objectsRef.current[itemId];
    const pos = mesh?.geometry?.attributes?.position?.array;
    if (!pos) return;
    const index = mesh.geometry.index ? mesh.geometry.index.array : null;
    const local =
      mode === "mass" ? massCentroidOf(pos, index) : bboxCenterOf(pos);
    useStore.getState().setItemOrigin(itemId, local);
  };

  controls.setRevolveEditHidden = (itemId) =>
    sweep.setRevolveEditHidden(itemId);
  controls.restoreRevolveEditHidden = () => sweep.restoreRevolveEditHidden();
  controls.clearSweepPreview = () => sweep.clearSweepPreview();
  controls.commitSweep = () => sweep.commitSweep();
  controls.cancelSweep = () => sweep.cancelSweep();
  // Renderer-side mesh split at the cut plane -- the fallback when OCC can't
  // rebuild a baked-mesh target as a solid.
  controls.meshSplit = (itemId, plane) => {
    const mesh = objectsRef.current[itemId];
    if (!mesh) return null;
    mesh.updateMatrixWorld(true);
    return meshSplit(mesh, plane);
  };
  attachSceneQueries({
    controls,
    scene,
    renderer,
    cameraRef,
    itemsRef,
    objectsRef,
    selectedIdRef,
    sketchShapesGroupRef,
  });

  // Plane / pattern / boolean / split / project / text previews -- they attach
  // themselves onto `controls`, so nothing here needs the return value.
  createToolPreviews({
    controls,
    extrude,
    highlights,
    scene,
    renderer,
    cameraRef,
    cameraAnimRef,
    cameraControlsRef,
    targetRef,
    itemsRef,
    objectsRef,
    selectedIdRef,
    setRotationState,
  });

  createMaterialAndFitHelpers({
    controls,
    scene,
    renderer,
    cameraRef,
    targetRef,
    itemsRef,
    objectsRef,
    handlesRef,
    boundingBoxRef,
    axisGroupRef,
    planeRef,
    sketchGridGroupRef,
    gridMaterial,
    rulerGroup,
  });

  // ── Transform-handle (gizmo) drag — 3D view mode ──────────────────────────
  const { handleAt, tryBeginHandleDrag, updateHandleDrag, commitHandleDrag } =
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
      highlightWorldPoint,
      isMac,
    },
  );

  // ── Sketch-mode interaction (selection / drag / draw / constraints) ───────
  const {
    onSketchMouseDown,
    onSketchMouseMove,
    onSketchMouseUp,
    onKeyDown,
    openLongPressMenuAt,
    clearSketchVisualsFor3D,
    refreshSketchSelectionOverlay,
    unsubItems,
    unsubMirror,
    unsubCircularPattern,
    unsubRectangularPattern,
    unsubCentre,
    unsubCog,
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
      if (sweepSelectModeRef && sweepSelectModeRef.current) {
        controls.mouseDownX = e.clientX;
        controls.mouseDownY = e.clientY;
        return;
      }
      if (onSketchMouseDown(e)) return;

      if (tryBeginHandleDrag(e)) return;
      controls.mouseDownX = e.clientX;
      controls.mouseDownY = e.clientY;
    } else mouseNav.onDown(e);
  };

  const onMouseMove = (e) => {
    const currentCamera = cameraRef.current;
    if (!currentCamera) return;
    if (mouseNav.onMove(e)) return;

    if (extrudeSelectModeRef && extrudeSelectModeRef.current) {
      // "start" and "to" both pick a face (extrudeFacePick.js).
      if (
        extrudeSelectModeRef.current === "start" ||
        extrudeSelectModeRef.current === "to"
      )
        handleExtrudeStartHover(e.clientX, e.clientY);
      else {
        // Any non-start extrude mode (the unified "profile" phase, or the legacy
        // "depth" state reached by Esc-ing out of start-pick) still lets the user
        // pick geometry — otherwise a click here is swallowed with no handler and
        // the selection is dead.
        // Left button held + moved → draw the drag-select box instead of hover.
        const dragging =
          (e.buttons & 1) === 1 &&
          controls.mouseDownX != null &&
          Math.hypot(
            e.clientX - controls.mouseDownX,
            e.clientY - controls.mouseDownY,
          ) >= 5;
        if (dragging)
          showExtrudeMarquee(
            controls.mouseDownX,
            controls.mouseDownY,
            e.clientX,
            e.clientY,
          );
        else handleExtrudeHover(e.clientX, e.clientY, e.shiftKey);
      }
      return;
    }
    if (sweepSelectModeRef && sweepSelectModeRef.current) {
      handleSweepHover(e.clientX, e.clientY);
      return;
    }
    if (useStore.getState().embossTool?.picking) {
      handleEmbossHover(e.clientX, e.clientY);
      return;
    }
    if (useStore.getState().textureTool?.picking) {
      handleTextureHover(e.clientX, e.clientY);
      return;
    }
    if (useStore.getState().stressTool || useStore.getState().optimiseTool) {
      if (handleStressHover(e.clientX, e.clientY)) return;
    }
    if (onSketchMouseMove(e)) return;

    clearSketchVisualsFor3D();

    if (updateHandleDrag(e)) return;

    onViewHover(e);
  };

  const onMouseUp = (e) => {
    if (mouseNav.onUp(e)) return;
    if (
      extrudeSelectModeRef &&
      extrudeSelectModeRef.current &&
      e.button === 0
    ) {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5) {
        if (
          extrudeSelectModeRef.current === "start" ||
          extrudeSelectModeRef.current === "to"
        )
          handleExtrudeStartClick(e.clientX, e.clientY);
        else handleExtrudeProfileClick(e.clientX, e.clientY, e.shiftKey);
      } else if (
        extrudeSelectModeRef.current !== "start" &&
        extrudeSelectModeRef.current !== "to"
      ) {
        // Drag-select: add the boxed regions, or remove them with Alt held.
        // Shift restricts text to the single glyph instead of the whole word.
        handleExtrudeProfileBox(
          controls.mouseDownX,
          controls.mouseDownY,
          e.clientX,
          e.clientY,
          e.altKey,
          e.shiftKey,
        );
      }
      clearExtrudeMarquee();
      return;
    }

    if (sweepSelectModeRef && sweepSelectModeRef.current && e.button === 0) {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5) handleSweepClick(e.clientX, e.clientY);
      return;
    }

    if (useStore.getState().embossTool?.picking && e.button === 0) {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5)
        handleEmbossClick(e.clientX, e.clientY, e.shiftKey);
      return;
    }
    if (useStore.getState().textureTool?.picking && e.button === 0) {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5) handleTextureClick(e.clientX, e.clientY);
      return;
    }
    if (
      (useStore.getState().stressTool || useStore.getState().optimiseTool) &&
      e.button === 0
    ) {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5 && handleStressClick(e.clientX, e.clientY))
        return;
    }

    if (onSketchMouseUp(e)) return;

    if (commitHandleDrag()) return;

    onViewMouseUp(e);
  };

  // ── Camera navigation (wheel; touch through touchInput.js) ──────────────────
  const { onMouseWheel, zoomBy, disposeNavigation } = createNavigationHandlers(
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
  // The mouse (mouseNavigation.js).  A right CLICK re-anchors the orbit pivot,
  // on release, so a right drag never re-anchors mid-gesture.
  const mouseNav = createMouseNavigation({
    onMouseWheel,
    // The ease runs on past the wheel's activity window, so each step asks
    // for its own frame.
    zoomBy: (scale) => {
      zoomBy(scale);
      requestRender();
    },
    preference: () => useStore.getState().wheelDevice,
    rightClick: () => {
      if (sketchModeRef.current) return;
      setOrbitAnchor(
        getOrbitAnchor(
          cameraRef,
          targetRef,
          raycasterRef,
          sceneRef,
          objectsRef,
          itemsRef,
          renderer,
        ),
        cameraRef,
        targetRef,
        cameraControlsRef,
        orbitIndicator,
      );
    },
  });

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
    cameraControlsRef,
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

  // On-demand rendering: invalidate a frame on EVERY store change (the
  // animate-loop comment always promised this wiring).  Without it, updates
  // that land asynchronously outside a pointer/key activity window — a
  // debounced tool preview finishing, a worker result, a dialog edit — sat
  // stale until the next mouse move over the viewport.
  const unsubscribeRender = useStore.subscribe(() => requestRender());

  // ── Attach listeners ───────────────────────────────────────────────────────

  const el = renderer.domElement;
  el.addEventListener("mousedown", onMouseDown);
  el.addEventListener("mousemove", onMouseMove);
  el.addEventListener("mouseup", onMouseUp);
  el.addEventListener("wheel", mouseNav.onWheel, { passive: false });
  const onContextMenu = (e) => e.preventDefault();
  el.addEventListener("contextmenu", onContextMenu);
  // Fingers and the Pencil, as clicks, drags and wheel gestures.
  const detachTouch = attachTouchInput(el, {
    onMouseDown,
    onMouseMove,
    onMouseUp,
    onMouseWheel,
    zoomBy,
    sketchModeRef,
    handleAt,
    bodyAt: (x, y) => {
      const rect = el.getBoundingClientRect();
      raycasterRef.current.setFromCamera(
        {
          x: ((x - rect.left) / rect.width) * 2 - 1,
          y: -((y - rect.top) / rect.height) * 2 + 1,
        },
        cameraRef.current,
      );
      const bodies = Object.values(objectsRef.current).filter(
        (o) => o?.visible,
      );
      return raycasterRef.current.intersectObjects(bodies, true).length > 0;
    },
    openLongPressMenuAt,
    home: () => controls.home?.(),
  });
  document.addEventListener("keyup", onModifierUp);
  document.addEventListener("keydown", onKeyDown);

  return () => {
    animateLoop.stop();
    unsubscribeRender();
    disposeNavigation();
    el.removeEventListener("mousedown", onMouseDown);
    el.removeEventListener("mousemove", onMouseMove);
    el.removeEventListener("mouseup", onMouseUp);
    el.removeEventListener("wheel", mouseNav.onWheel);
    mouseNav.dispose();
    el.removeEventListener("contextmenu", onContextMenu);
    detachTouch();
    document.removeEventListener("keyup", onModifierUp);
    document.removeEventListener("keydown", onKeyDown);
    unsubItems();
    unsubMirror();
    unsubCentre();
    unsubCog();
    componentMotion.dispose();
    unsubCircularPattern();
    unsubRectangularPattern();
  };
}
