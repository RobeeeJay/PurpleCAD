import * as THREE from "three";
import { useStore } from "../store";
import { constraintIconScreenPos } from "./sceneObjects/constraintIconSprites.js";
import { createHighlightHelpers } from "./cameraControls/highlights.js";
import { createExtrudeHelpers } from "./cameraControls/extrude.js";
import { createChamferPreviewHelpers } from "./cameraControls/chamferPreview.js";
import { createPushPullPreviewHelpers } from "./cameraControls/pushPull.js";
import { createShellPreviewHelpers } from "./cameraControls/shell.js";
import { createHolePreviewHelpers } from "./cameraControls/hole.js";
import { createEmbossPreviewHelpers } from "./cameraControls/emboss.js";
import { createTexturePreviewHelpers } from "./cameraControls/texture.js";
import { createDraftPreviewHelpers } from "./cameraControls/draft.js";
import { createSweepHelpers } from "./cameraControls/sweep.js";
import { meshBoolean, meshSplit } from "./meshBoolean.js";
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
  // Triangle-mesh boolean over the live scene meshes (used when an imported
  // mesh is an operand, where OCC's solid boolean is infeasible).
  controls.meshBoolean = (itemIds, operation) =>
    meshBoolean(
      itemIds.map((id) => objectsRef.current[id]).filter(Boolean),
      operation,
    );
  // Renderer-side mesh split (target ∩/− a half-space box at the cut plane) —
  // the fallback when OCC can't rebuild a baked-mesh target as a solid.
  controls.meshSplit = (itemId, plane) => {
    const mesh = objectsRef.current[itemId];
    if (!mesh) return null;
    mesh.updateMatrixWorld(true);
    return meshSplit(mesh, plane);
  };
  // World position + triangle/vertex counts of a selected object's live mesh,
  // for the status line.
  // The surface of a body that has no BAKED mesh.
  //
  // Extrudes and primitives are built analytically in the renderer, so
  // geometryData is empty for them and anything reading it alone sees no body
  // at all -- which is why Stress refused to open on an extrude. What is drawn
  // is a perfectly good watertight surface, in the same local frame the face
  // picks come back in, so the analysis can read it straight off the scene.
  controls.hasSurfaceMesh = (itemId) => {
    const p = objectsRef.current[itemId]?.geometry?.attributes?.position;
    return !!p && p.count >= 12;
  };
  controls.meshSurface = (itemId) => {
    const geom = objectsRef.current[itemId]?.geometry;
    const pos = geom?.attributes?.position;
    if (!pos) return null;
    return {
      positions: Array.from(pos.array),
      indices: geom.index ? Array.from(geom.index.array) : null,
    };
  };

  // A body's own surface for the agent API to measure: local positions and
  // indices plus the world matrix.  A mesh wearing a stress field or an
  // optimisation preview has had its geometry swapped, so it is the geometry
  // kept aside in userData that describes the body, not what is on screen.
  controls.meshWorldData = (itemId) => {
    const mesh = objectsRef.current[itemId];
    if (!mesh?.isMesh) return null;
    const geom = mesh.userData?.stressGeometry ?? mesh.geometry;
    const pos = geom?.attributes?.position;
    if (!pos) return null;
    mesh.updateMatrixWorld(true);
    return {
      positions: pos.array,
      indices: geom.index ? geom.index.array : null,
      matrix: Array.from(mesh.matrixWorld.elements),
      hull: !!mesh.userData?.hullGeometry,
    };
  };

  // What a body's mesh is currently WEARING: whether a per-vertex field is on
  // it and how varied it is.  The e2e suite's only way to see a stress plot --
  // the colours live in a BufferAttribute in the three.js scene, and no part
  // of that reaches the DOM.
  controls.meshDisplayInfo = (itemId) => {
    const mesh = objectsRef.current[itemId];
    if (!mesh?.isMesh) return null;
    const attr = mesh.geometry?.attributes?.color;
    const seen = new Set();
    if (attr)
      for (let i = 0; i < attr.count; i++)
        seen.add(
          [0, 1, 2].map((c) => attr.array[i * 3 + c].toFixed(3)).join(","),
        );
    return {
      hasVertexColors: !!attr && !!mesh.material?.vertexColors,
      colorCount: attr?.count ?? 0,
      distinctColors: seen.size,
      // Whether the mesh currently on screen is the body's own or something
      // swapped in over it (a stress field, an optimisation preview).
      vertexCount: mesh.geometry?.attributes?.position?.count ?? 0,
      swapped: !!mesh.userData?.stressGeometry,
    };
  };

  // The colours the open sketch's constraint annotations are currently drawn
  // in, as { [constraintIdx]: ["#rrggbb", ...] } — used by the e2e suite to
  // see that a dimension is highlighted.  Nothing else can: the annotations
  // live in the three.js scene, and a label's text is baked into a canvas
  // texture rather than sitting in the DOM.
  controls.sketchAnnotationColors = () => {
    const out = {};
    sketchShapesGroupRef.current?.traverse((o) => {
      const idx = o.userData?.constraintIdx;
      if (idx == null || !o.material?.color) return;
      (out[idx] ??= []).push("#" + o.material.color.getHexString());
    });
    return out;
  };

  // Dash sizes of every construction line on screen -- the sketch being edited
  // and sketches drawn in the 3D view alike. They are world lengths that the
  // render loop re-sizes every frame to hold a constant size on screen, which
  // is what the e2e suite reads them to check.
  controls.constructionDashSizes = () => {
    const out = [];
    scene.traverse((o) => {
      if (o.material?.userData?.screenDash)
        out.push({
          dashSize: o.material.dashSize,
          gapSize: o.material.gapSize,
        });
    });
    return out;
  };

  // Every toolbar-icon constraint marker in the sketch being edited: where its
  // anchor and its middle are on screen, and how big it is drawn.  The size is
  // measured independently of the render loop that set it (world scale over
  // world-per-pixel), so the e2e suite can check the loop got it right.
  controls.constraintMarkers = () => {
    const mesh = objectsRef.current[selectedIdRef.current];
    const cam = cameraRef.current;
    const group = sketchShapesGroupRef.current;
    if (!mesh || !cam || !group) return [];
    const rect = renderer.domElement.getBoundingClientRect();
    const out = [];
    group.traverse((o) => {
      const icon = o.userData.screenIcon;
      if (!icon) return;
      const anchor = constraintIconScreenPos(
        {
          userData: {
            constraintIconLocalPos: o.userData.constraintIconLocalPos,
          },
        },
        mesh,
        cam,
        rect,
      );
      const visibleHeight = cam.isOrthographicCamera
        ? (cam.top - cam.bottom) / cam.zoom
        : 2 *
          cam.position.distanceTo(o.getWorldPosition(new THREE.Vector3())) *
          Math.tan((cam.fov * Math.PI) / 360);
      out.push({
        type: o.userData.constraintType,
        constraintIdx: o.userData.constraintIdx,
        anchor,
        middle: constraintIconScreenPos(o, mesh, cam, rect),
        sizePx: (o.scale.x * rect.height) / visibleHeight,
        selected: !!icon.selected,
      });
    });
    return out;
  };

  // Project a world-space point to CSS pixel coordinates in the canvas —
  // used by the e2e suite to aim REAL mouse clicks at faces/edges (raycast
  // targets aren't DOM-addressable any other way).
  controls.worldToScreen = (x, y, z) => {
    const cam = cameraRef.current;
    if (!cam) return null;
    const v = new THREE.Vector3(x, y, z).project(cam);
    const rect = renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((v.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - v.y) / 2) * rect.height,
      inFront: v.z < 1,
    };
  };

  // Whole-scene totals for the corner stats tag: faces/points of every model
  // mesh currently displayed (sketches and reference planes excluded).
  controls.getSceneStats = () => {
    let faces = 0;
    let points = 0;
    for (const mesh of Object.values(objectsRef.current)) {
      const item = itemsRef.current.find((i) => i.id === mesh.userData.itemId);
      if (!item || item.type === "sketch" || item.type === "plane") continue;
      if (item.visible === false) continue;
      const g = mesh.geometry;
      const pos = g?.getAttribute("position");
      if (!pos) continue;
      points += pos.count;
      faces += g.index ? g.index.count / 3 : pos.count / 3;
    }
    return { faces: Math.round(faces), points };
  };

  controls.getObjectStats = (id) => {
    const mesh = objectsRef.current[id];
    const g = mesh?.geometry;
    const pos = g?.getAttribute("position");
    if (!pos) return null;
    const wp = mesh.getWorldPosition(new THREE.Vector3());
    return {
      worldPosition: { x: wp.x, y: wp.y, z: wp.z },
      points: pos.count,
      faces: g.index ? g.index.count / 3 : pos.count / 3,
    };
  };

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
    clearSketchVisualsFor3D,
    refreshSketchSelectionOverlay,
    unsubItems,
    unsubMirror,
    unsubCircularPattern,
    unsubRectangularPattern,
    unsubCentre,
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
    } else if (e.button === 2) {
      if (!sketchModeRef.current) {
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
      }
    }
  };

  const onMouseMove = (e) => {
    const currentCamera = cameraRef.current;
    if (!currentCamera) return;

    if (extrudeSelectModeRef && extrudeSelectModeRef.current) {
      if (extrudeSelectModeRef.current === "start")
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
    if (
      extrudeSelectModeRef &&
      extrudeSelectModeRef.current &&
      e.button === 0
    ) {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5) {
        if (extrudeSelectModeRef.current === "start")
          handleExtrudeStartClick(e.clientX, e.clientY);
        else handleExtrudeProfileClick(e.clientX, e.clientY, e.shiftKey);
      } else if (extrudeSelectModeRef.current !== "start") {
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
    unsubscribeRender();
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
    unsubMirror();
    unsubCentre();
    unsubCircularPattern();
    unsubRectangularPattern();
  };
}
