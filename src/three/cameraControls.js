import * as THREE from "three";
import { useStore } from "../store";
import { createHighlightHelpers } from "./cameraControls/highlights.js";
import { createExtrudeHelpers } from "./cameraControls/extrude.js";
import { createChamferPreviewHelpers } from "./cameraControls/chamferPreview.js";
import { createPushPullPreviewHelpers } from "./cameraControls/pushPull.js";
import { createSweepHelpers } from "./cameraControls/sweep.js";
import { meshBoolean } from "./meshBoolean.js";
import { frameFromPoints, frameFromPointNormal } from "./planeFrame.js";
import { createMaterialPreviewHelpers } from "./cameraControls/materialPreview.js";
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
      if (extrudeSelectModeRef.current === "profile")
        handleExtrudeHover(e.clientX, e.clientY);
      else if (extrudeSelectModeRef.current === "start")
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

    if (sweepSelectModeRef && sweepSelectModeRef.current && e.button === 0) {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5) handleSweepClick(e.clientX, e.clientY);
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
