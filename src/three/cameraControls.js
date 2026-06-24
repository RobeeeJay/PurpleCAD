import * as THREE from "three";
import { useStore } from "../store";
import { createHighlightHelpers } from "./cameraControls/highlights.js";
import { createExtrudeHelpers } from "./cameraControls/extrude.js";
import { createChamferPreviewHelpers } from "./cameraControls/chamferPreview.js";
import { createPushPullPreviewHelpers } from "./cameraControls/pushPull.js";
import { createShellPreviewHelpers } from "./cameraControls/shell.js";
import { createHolePreviewHelpers } from "./cameraControls/hole.js";
import { createEmbossPreviewHelpers } from "./cameraControls/emboss.js";
import { createDraftPreviewHelpers } from "./cameraControls/draft.js";
import { createSweepHelpers } from "./cameraControls/sweep.js";
import { meshBoolean, meshSplit } from "./meshBoolean.js";
import { getSketchShapePoints, MM_PER_UNIT } from "./sceneObjects.js";
import { textShapeContours, makeTextShape } from "./sketchText.js";
import { bboxCenterOf, massCentroidOf } from "./objectOrigin.js";
import { kvGet, kvSet } from "../store/kv.js";
import { frameFromPoints, frameFromPointNormal } from "./planeFrame.js";
import {
  featureEdgeGraph,
  edgePolylineNear,
  decomposeFeatureEdges,
  worldPolylineToLocal2D,
  fitProjectedShapes,
  dedupProjectedShapes,
} from "./sketchProjection.js";
import { createMaterialPreviewHelpers } from "./cameraControls/materialPreview.js";
import { createAnimateLoop } from "./cameraControls/animateLoop.js";
import { primitiveDimensions } from "./sceneObjects/dimensions.js";
import { createMaterial } from "./objectMaterials.js";
import { DEFAULT_MESH_COLOR } from "./theme.js";
import { createSnapHelpers } from "./cameraControls/snap.js";
import { createSketchHoverHelpers } from "./cameraControls/sketchHover.js";
import { createNavigationHandlers } from "./cameraControls/navigation.js";
import { createTransformHandleDrag } from "./cameraControls/transformHandleDrag.js";
import { createViewInteraction } from "./cameraControls/viewInteraction.js";
import { createEmbossInteraction } from "./cameraControls/embossPick.js";
import { createSketchInteraction } from "./cameraControls/sketchInteraction.js";

export function loadCameraState() {
  try {
    const saved = kvGet("cad-camera-state");
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
    kvSet(
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

  const { handleEmbossHover, handleEmbossClick, syncEmbossFills } =
    createEmbossInteraction({
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

  // Measure tool markers: a coloured sphere at each picked point and a dashed
  // line between two picks, so the user sees what was picked and what's measured.
  let measureGroup = null;
  controls.clearMeasureMarkers = () => {
    if (!measureGroup) return;
    scene.remove(measureGroup);
    measureGroup.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    measureGroup = null;
  };
  controls.updateMeasureMarkers = (picks) => {
    controls.clearMeasureMarkers();
    const pts = (picks || []).map((p) => p && p.at).filter(Boolean);
    if (pts.length === 0) return;
    const box = new THREE.Box3().setFromObject(scene);
    const diag = box.isEmpty() ? 1 : box.getSize(new THREE.Vector3()).length();
    const r = Math.max(0.02, diag * 0.006);
    const g = new THREE.Group();
    const colors = [0xffaa33, 0x33ddff];
    pts.forEach((p, i) => {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(r, 16, 12),
        new THREE.MeshBasicMaterial({
          color: colors[i % colors.length],
          depthTest: false,
        }),
      );
      m.position.set(p[0], p[1], p[2]);
      m.renderOrder = 1000;
      g.add(m);
    });
    if (pts.length >= 2) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(...pts[0]),
          new THREE.Vector3(...pts[1]),
        ]),
        new THREE.LineDashedMaterial({
          color: 0xffffff,
          dashSize: r * 2.5,
          gapSize: r * 1.5,
          depthTest: false,
        }),
      );
      line.computeLineDistances();
      line.renderOrder = 1000;
      g.add(line);
    }
    scene.add(g);
    measureGroup = g;
  };

  // Live primitive-dimensions preview (the dialog's dimensions, WITHOUT a store
  // rebuild, so resizing is instant).  A box (real geometry) scales in place so
  // its edges follow; a raymarched sphere/cylinder/torus/cone updates its shader
  // dimension uniforms and re-sizes its box hull.  The commit (modifyItem)
  // rebuilds from the store; clearBoxPreview reverts to the stored dimensions.
  const primHull = (type, d) => {
    if (type === "cube")
      return new THREE.BoxGeometry(d.width, d.height, d.depth);
    if (type === "sphere") {
      const r = d.radius * 2;
      return new THREE.BoxGeometry(r, r, r);
    }
    if (type === "cylinder")
      return new THREE.BoxGeometry(2 * d.radius, d.height, 2 * d.radius);
    if (type === "torus") {
      const o = 2 * (d.major + d.minor);
      return new THREE.BoxGeometry(o, 2 * d.minor, o);
    }
    if (type === "cone") {
      const o = 2 * Math.max(d.radiusBottom, d.radiusTop);
      return new THREE.BoxGeometry(o, d.height, o);
    }
    return null;
  };
  controls.previewBoxDimensions = (id, dims) => {
    const mesh = objectsRef.current[id];
    const item = itemsRef.current.find((i) => i.id === id);
    if (!mesh || !item) return;
    if (item.type === "cube") {
      const st = item.dimensions || { width: 2, height: 2, depth: 2 };
      const sc = item.scale || { x: 1, y: 1, z: 1 };
      mesh.scale.set(
        (sc.x ?? 1) * (dims.width / (st.width || 2)),
        (sc.y ?? 1) * (dims.height / (st.height || 2)),
        (sc.z ?? 1) * (dims.depth / (st.depth || 2)),
      );
      return;
    }
    const u = mesh.material?.uniforms;
    if (u) {
      if (u.uRadius && dims.radius != null) u.uRadius.value = dims.radius;
      if (u.uHalfH && dims.height != null) u.uHalfH.value = dims.height / 2;
      if (u.uMajor && dims.major != null) u.uMajor.value = dims.major;
      if (u.uMinor && dims.minor != null) u.uMinor.value = dims.minor;
      if (u.uRb && dims.radiusBottom != null) u.uRb.value = dims.radiusBottom;
      if (u.uRt && dims.radiusTop != null) u.uRt.value = dims.radiusTop;
    }
    const hull = primHull(item.type, dims);
    if (hull) {
      mesh.geometry.dispose();
      mesh.geometry = hull;
      mesh.userData.hullGeometry = hull;
    }
  };
  controls.clearBoxPreview = (id) => {
    const item = itemsRef.current.find((i) => i.id === id);
    if (item) controls.previewBoxDimensions(id, primitiveDimensions(item));
  };

  // Ghost preview for CREATING a primitive: a translucent copy of the actual
  // shape (real shader, so a sphere reads as a sphere) at the spawn point, before
  // anything is committed to the timeline.  Updated live as the dialog changes.
  let primGhost = null;
  controls.clearPrimitivePreview = () => {
    if (!primGhost) return;
    scene.remove(primGhost);
    primGhost.geometry?.dispose();
    primGhost.material?.dispose();
    primGhost = null;
  };
  controls.showPrimitivePreview = ({ type, dimensions, position }) => {
    const geo = primHull(type, dimensions);
    if (!geo) return;
    const mat = createMaterial({ type, dimensions }, DEFAULT_MESH_COLOR);
    if (mat.uniforms?.uOpacity) {
      mat.uniforms.uOpacity.value = 0.55;
      mat.transparent = true;
    } else {
      mat.opacity = 0.55;
      mat.transparent = true;
    }
    controls.clearPrimitivePreview();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(position.x, position.y, position.z);
    mesh.renderOrder = 5;
    scene.add(mesh);
    primGhost = mesh;
  };

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
  controls.updateChamferEditPreview = (
    regenerator,
    distanceMm,
    angleDeg,
    itemId,
  ) =>
    chamferPreview.updateChamferEditPreview(
      regenerator,
      distanceMm,
      angleDeg,
      itemId,
    );
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

  // Live preview of a Plane object while the creation dialog adjusts its
  // rotation/offset.  Pass null to clear.
  let planePreviewMesh = null;
  controls.previewPlane = (frame) => {
    if (!frame) {
      if (planePreviewMesh) {
        scene.remove(planePreviewMesh);
        planePreviewMesh.geometry.dispose();
        planePreviewMesh.material.dispose();
        planePreviewMesh = null;
      }
      return;
    }
    if (!planePreviewMesh) {
      planePreviewMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 6),
        new THREE.MeshBasicMaterial({
          color: 0x4488ff,
          transparent: true,
          opacity: 0.22,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      planePreviewMesh.renderOrder = 999;
      scene.add(planePreviewMesh);
    }
    planePreviewMesh.position.set(
      frame.position.x,
      frame.position.y,
      frame.position.z,
    );
    planePreviewMesh.rotation.set(
      frame.rotation.x || 0,
      frame.rotation.y || 0,
      frame.rotation.z || 0,
    );
  };
  controls.clearPlanePreview = () => controls.previewPlane(null);

  // Live preview of a 3D pattern (circular/rectangular) or a mirror while its
  // dialog adjusts parameters / picks.  Accepts a single result or an array of
  // results (Mirror can mirror several objects at once).  Pass null to clear.
  let patternPreviewGroup = null;
  controls.previewPattern3d = (result) => {
    if (patternPreviewGroup) {
      patternPreviewGroup.children.forEach((m) => {
        m.geometry.dispose();
        m.material.dispose();
      });
      scene.remove(patternPreviewGroup);
      patternPreviewGroup = null;
    }
    if (!result) return;
    const list = (Array.isArray(result) ? result : [result]).filter(
      (r) => r?.geometryData,
    );
    if (list.length === 0) return;
    const group = new THREE.Group();
    for (const r of list) {
      const { positions, indices } = r.geometryData;
      const geom = new THREE.BufferGeometry();
      geom.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(positions), 3),
      );
      if (indices)
        geom.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
      geom.computeVertexNormals();
      const mesh = new THREE.Mesh(
        geom,
        new THREE.MeshStandardMaterial({
          color: 0x6c3fd4,
          roughness: 0.55,
          metalness: 0,
          transparent: true,
          opacity: 0.65,
        }),
      );
      const p = r.position || { x: 0, y: 0, z: 0 };
      mesh.position.set(p.x, p.y, p.z);
      mesh.renderOrder = 998;
      group.add(mesh);
    }
    scene.add(group);
    patternPreviewGroup = group;
  };
  controls.clearPattern3dPreview = () => controls.previewPattern3d(null);

  // Pick 3 points (snapping to object vertices) to define a new Plane.  Markers
  // mark each pick; the 3rd derives a frame and opens the creation dialog.
  let planePickPoints = [];
  let planePickMarkers = [];
  controls.clearPlanePick = () => {
    planePickMarkers.forEach((m) => {
      scene.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    });
    planePickMarkers = [];
    planePickPoints = [];
  };
  controls.planePickClick = (screenX, screenY) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    const meshes = Object.values(objectsRef.current).filter(
      (m) => m.visible !== false,
    );
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) return;
    // Snap to the nearest vertex of the hit triangle (real geometry only);
    // primitives raycast against a hull/sphere, so fall back to the hit point.
    let p = hit.point.clone();
    const posAttr = hit.face && hit.object.geometry?.getAttribute("position");
    if (posAttr) {
      let best = p,
        bd = Infinity;
      [hit.face.a, hit.face.b, hit.face.c].forEach((idx) => {
        const v = new THREE.Vector3()
          .fromBufferAttribute(posAttr, idx)
          .applyMatrix4(hit.object.matrixWorld);
        const d = v.distanceTo(hit.point);
        if (d < bd) {
          bd = d;
          best = v;
        }
      });
      p = best;
    }
    planePickPoints.push({ x: p.x, y: p.y, z: p.z });
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x44aaff, depthTest: false }),
    );
    marker.position.copy(p);
    marker.renderOrder = 1011;
    scene.add(marker);
    planePickMarkers.push(marker);

    if (planePickPoints.length >= 3) {
      const base = frameFromPoints(
        planePickPoints[0],
        planePickPoints[1],
        planePickPoints[2],
      );
      controls.clearPlanePick();
      useStore.getState().setPlanePickActive(false);
      if (base) useStore.getState().startPlaneTool(base);
      else
        useStore
          .getState()
          .showNotification?.("Pick three non-collinear points.");
    }
  };

  // Pick an object face: its world plane (click point + face normal) seeds a
  // new Plane and reopens the creation dialog.
  controls.planeFacePickClick = (screenX, screenY) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    const meshes = Object.values(objectsRef.current).filter(
      (m) => m.visible !== false,
    );
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit || !hit.face) {
      useStore.getState().showNotification?.("Click a face to define a plane.");
      return;
    }
    const nm = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const worldN = hit.face.normal.clone().applyMatrix3(nm).normalize();
    const base = frameFromPointNormal(hit.point, worldN);
    useStore.getState().setPlanePickActive(false);
    if (base) useStore.getState().startPlaneTool(base);
  };

  // Pick the circular pattern's rotation axis: the nearest sketch line or solid
  // face edge under the cursor.  Stores it as { origin, dir } (world) on the
  // pattern tool, highlights it, and ends the pick.
  let circularAxisHL = null;
  controls.clearCircularAxisHighlight = () => {
    if (!circularAxisHL) return;
    scene.remove(circularAxisHL);
    circularAxisHL.geometry.dispose();
    circularAxisHL.material.dispose();
    circularAxisHL = null;
  };
  controls.pickCircularAxis = (screenX, screenY) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const toScreen = (w) => {
      const ndc = w.clone().project(cameraRef.current);
      return {
        x: ((ndc.x + 1) / 2) * rect.width + rect.left,
        y: ((-ndc.y + 1) / 2) * rect.height + rect.top,
      };
    };
    const segDist = (px, py, a, b) => {
      const dx = b.x - a.x,
        dy = b.y - a.y;
      const l2 = dx * dx + dy * dy || 1e-9;
      let t = ((px - a.x) * dx + (py - a.y) * dy) / l2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
    };
    let best = null;
    let bestD = 14;
    const consider = (wa, wb) => {
      const d = segDist(screenX, screenY, toScreen(wa), toScreen(wb));
      if (d < bestD) {
        bestD = d;
        best = { a: wa.clone(), b: wb.clone() };
      }
    };
    // Sketch lines (a clean straight axis the user can draw on purpose).
    itemsRef.current.forEach((sk) => {
      if (sk.type !== "sketch") return;
      const mesh = objectsRef.current[sk.id];
      if (!mesh || mesh.visible === false) return;
      (sk.shapes || []).forEach((s) => {
        if (s.type !== "line") return;
        const wa = new THREE.Vector3(s.x1, s.y1, 0)
          .applyQuaternion(mesh.quaternion)
          .add(mesh.position);
        const wb = new THREE.Vector3(s.x2, s.y2, 0)
          .applyQuaternion(mesh.quaternion)
          .add(mesh.position);
        consider(wa, wb);
      });
    });
    // Face edges: the edges of the triangle hit under the cursor (a model edge
    // of a box/extrude face is the nearest of the three to the click).
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    const meshes = Object.values(objectsRef.current).filter(
      (m) => m.visible !== false,
    );
    const hit = ray.intersectObjects(meshes, false)[0];
    if (hit && hit.face) {
      const posAttr = hit.object.geometry.getAttribute("position");
      const v = (i) =>
        new THREE.Vector3()
          .fromBufferAttribute(posAttr, i)
          .applyMatrix4(hit.object.matrixWorld);
      const va = v(hit.face.a),
        vb = v(hit.face.b),
        vc = v(hit.face.c);
      consider(va, vb);
      consider(vb, vc);
      consider(vc, va);
    }
    if (!best) {
      useStore
        .getState()
        .showNotification?.("Click a sketch line or a face edge for the axis.");
      return;
    }
    const dir = best.b.clone().sub(best.a).normalize();
    controls.clearCircularAxisHighlight();
    const geo = new THREE.BufferGeometry().setFromPoints([best.a, best.b]);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0x44aaff, depthTest: false }),
    );
    line.renderOrder = 1011;
    scene.add(line);
    circularAxisHL = line;
    useStore.getState().setCircularAxisPick(false);
    useStore.getState().updatePattern3d({
      axis: {
        origin: { x: best.a.x, y: best.a.y, z: best.a.z },
        dir: { x: dir.x, y: dir.y, z: dir.z },
      },
    });
  };

  // Split tool picks (plain clicks): first an object to split, then a cut — a
  // Plane/sketch item, or any solid face (its plane).  Shows a translucent
  // preview of the cut plane.  Mirrors the plane face-pick raycast.
  const splitRaycast = (screenX, screenY) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    const meshes = Object.values(objectsRef.current).filter(
      (m) => m.visible !== false,
    );
    return ray.intersectObjects(meshes, false)[0] || null;
  };
  const SPLIT_SOLIDS = [
    "cube",
    "sphere",
    "cylinder",
    "torus",
    "extrude",
    "csg",
  ];
  controls.pickSplitObject = (screenX, screenY) => {
    const hit = splitRaycast(screenX, screenY);
    const item = hit
      ? itemsRef.current.find((i) => i.id === hit.object.userData.itemId)
      : null;
    if (!item || !SPLIT_SOLIDS.includes(item.type)) {
      useStore.getState().showNotification?.("Click an object to split.");
      return;
    }
    useStore
      .getState()
      .updateSplit3d({ objectId: item.id, objectName: item.name });
    // Guide the user straight on to picking the cut.
    useStore.getState().setSplitPick("cut");
  };
  controls.pickSplitCut = (screenX, screenY) => {
    const hit = splitRaycast(screenX, screenY);
    const item = hit
      ? itemsRef.current.find((i) => i.id === hit.object.userData.itemId)
      : null;
    if (!item) {
      useStore
        .getState()
        .showNotification?.("Click a plane, a sketch, or a face to cut along.");
      return;
    }
    let frame, label;
    if (item.type === "plane" || item.type === "sketch") {
      frame = { position: item.position, rotation: item.rotation };
      label = item.name;
    } else if (hit.face) {
      const nm = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
      const worldN = hit.face.normal.clone().applyMatrix3(nm).normalize();
      frame = frameFromPointNormal(hit.point, worldN);
      label = `face of ${item.name}`;
    }
    if (!frame) return;
    useStore.getState().updateSplit3d({ cutFrame: frame, cutLabel: label });
    useStore.getState().setSplitPick(null);
    controls.previewPlane(frame);
  };

  // ── Project tool ──────────────────────────────────────────────────────────
  // Project 3D feature edges onto the active sketch plane as sketch geometry,
  // each linked to its source by a projection constraint (tracks the source,
  // immovable until released).  A click projects all connected edges of the
  // body under the cursor; a marquee box projects every edge inside it.
  const activeSketchForProject = () => {
    const sketch = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current && i.type === "sketch",
    );
    const sketchMesh = sketch ? objectsRef.current[sketch.id] : null;
    return sketch && sketchMesh ? { sketch, sketchMesh } : null;
  };
  const projectSolidMeshes = () =>
    Object.values(objectsRef.current).filter((m) => {
      const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
      return it && it.type !== "sketch";
    });
  // World feature-edge graph of a solid mesh, plus its world matrix.  Bails on a
  // mesh too dense to graph cheaply (an imported/high-res body would freeze).
  const MAX_PROJECT_TRIS = 40000;
  const bodyEdgeGraph = (solid) => {
    solid.updateMatrixWorld(true);
    const posAttr = solid.geometry?.getAttribute("position");
    if (!posAttr) return null;
    const idx = solid.geometry.getIndex();
    if ((idx ? idx.count : posAttr.count) / 3 > MAX_PROJECT_TRIS) return null;
    const mw = solid.matrixWorld;
    const tmp = new THREE.Vector3();
    const positions = new Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      tmp.fromBufferAttribute(posAttr, i).applyMatrix4(mw);
      positions[i * 3] = tmp.x;
      positions[i * 3 + 1] = tmp.y;
      positions[i * 3 + 2] = tmp.z;
    }
    const idxAttr = solid.geometry.getIndex();
    const indices = idxAttr ? Array.from(idxAttr.array) : null;
    // The sketch plane's world normal (toward the viewer) — keep only edges on a
    // face that faces it, so hidden back edges aren't projected.
    const ctx = activeSketchForProject();
    let planeNormal = null;
    if (ctx) {
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(
        ctx.sketchMesh.quaternion,
      );
      planeNormal = { x: n.x, y: n.y, z: n.z };
    }
    return {
      graph: featureEdgeGraph(positions, indices, undefined, planeNormal),
      mw,
    };
  };
  // Fit a list of world-polyline chains belonging to one source body and return
  // their projected sketch shapes (each chain its own projection group).
  const chainsToShapes = (sourceId, mw, sketchMesh, chains) => {
    const invMw = new THREE.Matrix4().copy(mw).invert();
    const out = [];
    chains.forEach((chain) => {
      const localPolyline = chain.map((p) => {
        const v = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(invMw);
        return [v.x, v.y, v.z];
      });
      const pts2d = worldPolylineToLocal2D(
        chain,
        sketchMesh.position,
        sketchMesh.quaternion,
      );
      const edgeKey = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
      out.push(
        ...fitProjectedShapes(pts2d, {
          projection: {
            sourceId,
            edgeKey,
            key: `${sourceId}:${edgeKey}`,
            localPolyline,
          },
        }),
      );
    });
    return out;
  };

  // Guard against pathological bodies (a dense/faceted mesh can have thousands
  // of feature edges) — projecting that many would freeze the app.
  const MAX_PROJECTED = 300;
  // A solid's screen-space bounding box (or null), for cheaply skipping bodies
  // that can't overlap a marquee before building their (possibly huge) graph.
  const solidScreenBox = (solid, rect) => {
    const g = solid.geometry;
    if (!g) return null;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    if (!bb) return null;
    solid.updateMatrixWorld(true);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const v = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(
        i & 1 ? bb.max.x : bb.min.x,
        i & 2 ? bb.max.y : bb.min.y,
        i & 4 ? bb.max.z : bb.min.z,
      )
        .applyMatrix4(solid.matrixWorld)
        .project(cameraRef.current);
      const sx = ((v.x + 1) / 2) * rect.width + rect.left;
      const sy = ((-v.y + 1) / 2) * rect.height + rect.top;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    return { minX, maxX, minY, maxY };
  };

  // Click: project every connected edge of the body under the cursor.
  controls.projectEdgeAt = (screenX, screenY) => {
    const store = useStore.getState();
    const ctx = activeSketchForProject();
    if (!ctx) return;
    const solids = projectSolidMeshes();
    const prevVisible = solids.map((m) => m.visible);
    solids.forEach((m) => (m.visible = true));
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    const hit = ray.intersectObjects(solids, false)[0];
    solids.forEach((m, i) => (m.visible = prevVisible[i]));
    if (!hit) {
      store.showNotification?.("Click a 3D edge to project.");
      return;
    }
    const built = bodyEdgeGraph(hit.object);
    if (!built) {
      store.showNotification?.("That body is too dense to project edges from.");
      return;
    }
    // The clicked edge's connected component → its smooth chains.  (A body's
    // feature edges are one component, so this is "all connected lines".)
    let chains = decomposeFeatureEdges(built.graph);
    const nearest = edgePolylineNear(built.graph, hit.point);
    if (!chains.length && nearest) chains = [nearest];
    const shapes = dedupProjectedShapes(
      chainsToShapes(
        hit.object.userData.itemId,
        built.mw,
        ctx.sketchMesh,
        chains,
      ),
    );
    if (shapes.length === 0) {
      store.showNotification?.("No projectable edges there.");
      return;
    }
    if (shapes.length > MAX_PROJECTED) {
      store.showNotification?.(
        "That body has too many edges to project at once.",
      );
      return;
    }
    store.addProjectShapes(shapes);
    controls.previewProjection(useStore.getState().projectTool?.shapes);
  };

  // Marquee: project every feature edge whose screen midpoint falls in the box.
  controls.projectEdgesInBox = (box) => {
    const store = useStore.getState();
    const ctx = activeSketchForProject();
    if (!ctx) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const minX = Math.min(box.x1, box.x2),
      maxX = Math.max(box.x1, box.x2),
      minY = Math.min(box.y1, box.y2),
      maxY = Math.max(box.y1, box.y2);
    const inBox = (p) => {
      const ndc = new THREE.Vector3(p.x, p.y, p.z).project(cameraRef.current);
      if (ndc.z > 1) return false;
      const sx = ((ndc.x + 1) / 2) * rect.width + rect.left;
      const sy = ((-ndc.y + 1) / 2) * rect.height + rect.top;
      return sx >= minX && sx <= maxX && sy >= minY && sy <= maxY;
    };
    const allShapes = [];
    let aborted = false;
    for (const solid of projectSolidMeshes()) {
      // Skip bodies whose screen bbox can't overlap the marquee, so a dense mesh
      // off to the side isn't graphed at all.
      const sb = solidScreenBox(solid, rect);
      if (
        sb &&
        (sb.maxX < minX || sb.minX > maxX || sb.maxY < minY || sb.minY > maxY)
      )
        continue;
      const built = bodyEdgeGraph(solid);
      if (!built) continue;
      const chains = decomposeFeatureEdges(built.graph).filter((chain) =>
        inBox(chain[Math.floor(chain.length / 2)]),
      );
      if (chains.length)
        allShapes.push(
          ...chainsToShapes(
            solid.userData.itemId,
            built.mw,
            ctx.sketchMesh,
            chains,
          ),
        );
      if (allShapes.length > MAX_PROJECTED) {
        aborted = true;
        break;
      }
    }
    if (aborted) {
      store.showNotification?.(
        "Too many edges in the box — select a smaller region.",
      );
      return;
    }
    const deduped = dedupProjectedShapes(allShapes);
    if (deduped.length === 0) {
      store.showNotification?.("No edges inside the box.");
      return;
    }
    store.addProjectShapes(deduped);
    controls.previewProjection(useStore.getState().projectTool?.shapes);
  };

  // Live preview of the staged projection: the accumulated sketch shapes drawn
  // on the sketch plane (teal) before they're committed by the dialog.
  let projectionPreviewGroup = null;
  controls.clearProjectionPreview = () => {
    if (!projectionPreviewGroup) return;
    scene.remove(projectionPreviewGroup);
    projectionPreviewGroup.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    projectionPreviewGroup = null;
  };
  controls.previewProjection = (shapes) => {
    controls.clearProjectionPreview();
    const ctx = activeSketchForProject();
    if (!ctx || !shapes || shapes.length === 0) return;
    const group = new THREE.Group();
    for (const shape of shapes) {
      const pts = getSketchShapePoints(shape, ctx.sketchMesh);
      if (!pts || pts.length < 2) continue;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: 0x37b8a0,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        }),
      );
      line.renderOrder = 1011;
      line.frustumCulled = false;
      group.add(line);
    }
    scene.add(group);
    projectionPreviewGroup = group;
  };

  // Live Text-tool preview: draw the draft text's glyph outlines on the active
  // sketch plane while the Text dialog is open (driven by its inputs).
  let textPreviewGroup = null;
  controls.clearTextPreview = () => {
    if (!textPreviewGroup) return;
    scene.remove(textPreviewGroup);
    textPreviewGroup.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    textPreviewGroup = null;
  };
  controls.updateTextPreview = (draft) => {
    controls.clearTextPreview();
    const ctx = activeSketchForProject();
    if (!ctx || !draft) return;
    const shape = makeTextShape({
      text: draft.text,
      height: (draft.heightMm || 0) / MM_PER_UNIT,
      font: draft.font,
      x: draft.x,
      y: draft.y,
    });
    const { sketchMesh } = ctx;
    const toW = (lx, ly) =>
      new THREE.Vector3(lx, ly, 0.004)
        .applyQuaternion(sketchMesh.quaternion)
        .add(sketchMesh.position);
    const group = new THREE.Group();
    for (const contour of textShapeContours(shape)) {
      if (contour.length < 2) continue;
      const pts = [...contour, contour[0]].map((p) => toW(p.x, p.y));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: 0x6c3fd4,
          depthTest: false,
          transparent: true,
          opacity: 0.9,
        }),
      );
      line.renderOrder = 1011;
      line.frustumCulled = false;
      group.add(line);
    }
    scene.add(group);
    textPreviewGroup = group;
  };

  // Hover feedback: highlight the connected feature edges of the body under the
  // cursor (what a click would project).  The body's edge graph is cached so
  // sweeping across the same body doesn't rebuild it each frame.
  let projectHoverGroup = null;
  let projectHoverCache = null; // { bodyId, sig, chains }
  controls.clearProjectHover = () => {
    if (!projectHoverGroup) return;
    scene.remove(projectHoverGroup);
    projectHoverGroup.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    projectHoverGroup = null;
  };
  controls.projectHoverAt = (screenX, screenY) => {
    const ctx = activeSketchForProject();
    if (!ctx) {
      controls.clearProjectHover();
      return;
    }
    const solids = projectSolidMeshes();
    const prevVisible = solids.map((m) => m.visible);
    solids.forEach((m) => (m.visible = true));
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    const hit = ray.intersectObjects(solids, false)[0];
    solids.forEach((m, i) => (m.visible = prevVisible[i]));
    if (!hit) {
      controls.clearProjectHover();
      return;
    }
    const solid = hit.object;
    const bodyId = solid.userData.itemId;
    solid.updateMatrixWorld(true);
    ctx.sketchMesh.updateMatrixWorld(true);
    const sig = `${solid.matrixWorld.elements.map((e) => Math.round(e * 1e3)).join(",")}|${ctx.sketchMesh.matrixWorld.elements.map((e) => Math.round(e * 1e3)).join(",")}`;
    const bodyKey = `${bodyId}|${sig}`;
    // The outline is fixed for a given body+sketch, so only recompute when the
    // hovered body changes — not on every mouse-move.
    if (projectHoverGroup && projectHoverGroup.userData.bodyKey === bodyKey)
      return;
    if (!projectHoverCache || projectHoverCache.bodyKey !== bodyKey) {
      const built = bodyEdgeGraph(solid);
      let shapes = [];
      if (built) {
        for (const chain of decomposeFeatureEdges(built.graph)) {
          const pts2d = worldPolylineToLocal2D(
            chain,
            ctx.sketchMesh.position,
            ctx.sketchMesh.quaternion,
          );
          shapes.push(...fitProjectedShapes(pts2d));
        }
        shapes = dedupProjectedShapes(shapes);
      }
      projectHoverCache = { bodyKey, shapes };
    }
    controls.clearProjectHover();
    if (projectHoverCache.shapes.length === 0) return;
    // Draw the would-be projection ON the sketch plane (where the user is
    // looking), in gold to distinguish it from the teal staged preview.
    const group = new THREE.Group();
    group.userData.bodyKey = bodyKey;
    for (const shape of projectHoverCache.shapes) {
      const pts = getSketchShapePoints(shape, ctx.sketchMesh);
      if (!pts || pts.length < 2) continue;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: 0xffcc44,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        }),
      );
      line.renderOrder = 1013;
      line.frustumCulled = false;
      group.add(line);
    }
    scene.add(group);
    projectHoverGroup = group;
  };

  // Snapshot / restore the camera view (used by the Objects-list Solo button so
  // toggling solo off returns to where the user was).
  controls.captureView = () => {
    if (!cameraRef.current || !cameraControlsRef.current) return null;
    return {
      positionX: cameraRef.current.position.x,
      positionY: cameraRef.current.position.y,
      positionZ: cameraRef.current.position.z,
      targetX: targetRef.current.x,
      targetY: targetRef.current.y,
      targetZ: targetRef.current.z,
      rotationX: cameraControlsRef.current.targetRotationX,
      rotationY: cameraControlsRef.current.targetRotationY,
      up: cameraRef.current.up.clone(),
    };
  };
  // Tween the camera to frame a single object (its world bounding box), keeping
  // the current view direction.  Used by Solo so the soloed object fills the
  // view.
  controls.frameObject = (itemId) => {
    const mesh = objectsRef.current?.[itemId];
    const camera = cameraRef.current;
    if (!mesh || !camera) return;
    mesh.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(
      box.getBoundingSphere(new THREE.Sphere()).radius,
      0.001,
    );
    // Preserve the current orbit direction (camera → target), just change how
    // far back the camera sits so the bbox sphere fits the frustum.
    const dir = camera.position.clone().sub(targetRef.current);
    if (dir.lengthSq() < 1e-9) dir.set(0, 0, 1);
    dir.normalize();
    let dist;
    if (camera.isPerspectiveCamera) {
      const vFov = (camera.fov * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (camera.aspect || 1));
      dist = (radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.2;
    } else {
      dist = radius * 3;
    }
    cameraAnimRef.current = {
      startPos: camera.position.clone(),
      endPos: center.clone().add(dir.multiplyScalar(dist)),
      startTarget: targetRef.current.clone(),
      endTarget: center.clone(),
      startUp: camera.up.clone(),
      endUp: camera.up.clone(),
      startTime: Date.now(),
      duration: 400,
    };
  };

  controls.restoreView = (saved) => {
    if (!saved || !cameraRef.current || !cameraControlsRef.current) return;
    const camera = cameraRef.current;
    const cc = cameraControlsRef.current;
    cameraAnimRef.current = {
      startPos: camera.position.clone(),
      endPos: new THREE.Vector3(
        saved.positionX,
        saved.positionY,
        saved.positionZ,
      ),
      startTarget: targetRef.current.clone(),
      endTarget: new THREE.Vector3(saved.targetX, saved.targetY, saved.targetZ),
      startUp: camera.up.clone(),
      endUp: saved.up ? saved.up.clone() : new THREE.Vector3(0, 1, 0),
      startTime: Date.now(),
      duration: 400,
      onComplete: () => {
        cc.targetRotationX = saved.rotationX;
        cc.targetRotationY = saved.rotationY;
        setRotationState(cameraRef.current.quaternion.clone());
      },
    };
  };

  // Live preview for MaterialDialog: instantly applies in-progress
  // color/finish edits to the live mesh(es) without a store write.
  const materialPreview = createMaterialPreviewHelpers({
    objectsRef,
    itemsRef,
  });
  controls.previewMaterial = (target, materialProps) =>
    materialPreview.previewMaterial(target, materialProps);
  controls.restoreMaterialPreview = (target) =>
    materialPreview.restoreMaterialPreview(target);

  // The current view centre (camera orbit target) in world coords — the
  // toolbar reads this so a newly created primitive spawns where the user is
  // looking instead of always at the world origin.
  controls.getViewTarget = () => targetRef.current.clone();

  // Capture the current viewport canvas as a PNG blob, for the Save menu's
  // "Save image" option.  Relies on preserveDrawingBuffer (sceneSetup.js) so
  // the buffer is still readable after the frame has been composited.
  controls.captureScreenshot = () =>
    new Promise((resolve) => renderer.domElement.toBlob(resolve, "image/png"));

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
      if (extrudeSelectModeRef.current === "profile") {
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
      } else if (extrudeSelectModeRef.current === "start")
        handleExtrudeStartHover(e.clientX, e.clientY);
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
      return;
    }
    if (sweepSelectModeRef && sweepSelectModeRef.current) {
      handleSweepHover(e.clientX, e.clientY);
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
      return;
    }
    if (useStore.getState().embossTool?.picking) {
      handleEmbossHover(e.clientX, e.clientY);
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
          handleExtrudeProfileClick(e.clientX, e.clientY, e.shiftKey);
        else if (extrudeSelectModeRef.current === "start")
          handleExtrudeStartClick(e.clientX, e.clientY);
      } else if (extrudeSelectModeRef.current === "profile") {
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
    unsubMirror();
    unsubCircularPattern();
    unsubRectangularPattern();
  };
}
