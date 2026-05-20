import React, { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import RotationWidget from "./RotationWidget";
import BusyIndicator from "./BusyIndicator";
import SketchOverlays from "./viewport/SketchOverlays";
import { useViewportInit } from "./viewport/useViewportInit";
import { useSketchModeEffect } from "./viewport/useSketchModeEffect";
import "../styles/Viewport.css";
import { useStore } from "../store";
import {
  buildSceneObjects,
  buildTransformHandles,
  buildSketchShapesGroup,
  buildAllSketchShapesGroup,
  buildExtrudeSelectGroup,
  applyRenderMode,
} from "../three/sceneObjects.js";
import { updateEmissive } from "../three/objectMaterials.js";
import { saveCameraState } from "../three/cameraControls.js";
import { reconcileSelectionHighlight } from "../three/selectionHighlights.js";

const Viewport = () => {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const objectsRef = useRef({});
  const originalMaterialsRef = useRef({});
  const planeRef = useRef(null);
  const shadowGroundRef = useRef(null);
  const shadowLightRef = useRef(null);
  const targetRef = useRef(new THREE.Vector3(0, 0, 0));
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());
  const cameraControlsRef = useRef({
    isRotating: false,
    isPanning: false,
    mouseX: 0,
    mouseY: 0,
    targetRotationX: 0,
    targetRotationY: 0,
  });
  const handlesRef = useRef([]);
  const handleDragRef = useRef(null);
  const transformDebounceRef = useRef(null);
  const boundingBoxRef = useRef(null);
  const axisGroupRef = useRef(null);
  const composerRef = useRef(null);
  const envTextureRef = useRef(null);
  const faceHighlightRef = useRef(null);
  const edgeHighlightRef = useRef(null);
  const pointHighlightRef = useRef(null);
  const subGeoHighlightGroupRef = useRef(null);
  const sketchModeRef = useRef(false);
  const savedCameraStateRef = useRef(null);
  const sketchGridGroupRef = useRef(null);
  const cameraAnimRef = useRef(null);
  const sketchPlacementModeRef = useRef(false);
  const sketchPlacementPlanesRef = useRef([]);
  const extrudeSelectModeRef = useRef(null);
  const extrudeSelectGroupRef = useRef(null);
  const sketchDrawRef = useRef(null);
  const sketchShapesGroupRef = useRef(null);
  const allSketchGroupRef = useRef(null);
  const sketchGhostGroupRef = useRef(null);
  // Remembers the user's projection setting from before entering sketch
  // mode so it can be restored on exit.  Sketch mode forces isometric
  // (orthographic) projection so the sketch plane has no perspective
  // distortion.
  const preSketchProjectionRef = useRef(null);
  const dimHintRef = useRef(null);
  const propagateConstraintsRef = useRef(null);

  const [rotationState, setRotationState] = React.useState(null);
  const [sketchDrawPhase, setSketchDrawPhase] = React.useState(null);
  const [sketchMode, setSketchMode] = React.useState(false);

  const selectedIdRef = useRef(null);
  const selectedIdsRef = useRef([]);
  const itemsRef = useRef([]);
  const activeSketchToolRef = useRef(null);

  const items = useStore((state) => state.items);
  const variables = useStore((state) => state.variables);
  const theme = useStore((state) => state.theme);
  const hoveredId = useStore((state) => state.hoveredId);
  const setHoveredId = useStore((state) => state.setHoveredId);
  const selectedId = useStore((state) => state.selectedId);
  const selectedIds = useStore((state) => state.selectedIds);
  const selectItem = useStore((state) => state.selectItem);
  const renderMode = useStore((state) => state.renderMode);
  const shadowsEnabled = useStore((state) => state.shadowsEnabled);
  const projectionMode = useStore((state) => state.projectionMode);
  const widgetVisible = useStore((state) => state.widgetVisible);
  const axisVisible = useStore((state) => state.axisVisible);
  const cameraResetTrigger = useStore((state) => state.cameraResetTrigger);
  const sketchPlacementMode = useStore((state) => state.sketchPlacementMode);
  const extrudeSelectMode = useStore((state) => state.extrudeSelectMode);
  const extrudeDepthInput = useStore((state) => state.extrudeDepthInput);
  const activeSketchTool = useStore((state) => state.activeSketchTool);
  const sketchConstraintMode = useStore((state) => state.sketchConstraintMode);
  const sketchConstraintFirstPoint = useStore(
    (state) => state.sketchConstraintFirstPoint,
  );
  const sketchModifyMode = useStore((state) => state.sketchModifyMode);
  const sketchDistanceInput = useStore((state) => state.sketchDistanceInput);
  const constraintsVisible = useStore((state) => state.constraintsVisible);
  const dimensionsVisible = useStore((state) => state.dimensionsVisible);
  const curveResolution = useStore((state) => state.curveResolution);
  const selectedSubGeometry = useStore((state) => state.selectedSubGeometry);
  const curveSegments = 32;
  const printPrecision = curveResolution === "print" ? 0.01 : null;

  const _selItem = items.find((i) => i.id === selectedId);
  const isInSketchMode = _selItem != null && _selItem.type === "sketch";

  selectedIdRef.current = selectedId;
  selectedIdsRef.current = selectedIds;
  itemsRef.current = items;
  sketchPlacementModeRef.current = sketchPlacementMode;
  activeSketchToolRef.current = activeSketchTool;
  extrudeSelectModeRef.current = extrudeSelectMode;

  const handleOrientationChange = useCallback((targetRotX, targetRotY) => {
    if (!cameraRef.current || !cameraControlsRef.current) return;
    const camera = cameraRef.current;
    const controls = cameraControlsRef.current;
    const distance = camera.position.distanceTo(targetRef.current);
    const endPos = new THREE.Vector3(
      targetRef.current.x +
        Math.sin(targetRotY) * Math.cos(targetRotX) * distance,
      targetRef.current.y + Math.sin(targetRotX) * distance,
      targetRef.current.z +
        Math.cos(targetRotY) * Math.cos(targetRotX) * distance,
    );
    cameraAnimRef.current = {
      startPos: camera.position.clone(),
      endPos,
      startTarget: targetRef.current.clone(),
      endTarget: targetRef.current.clone(),
      startUp: camera.up.clone(),
      endUp: new THREE.Vector3(0, 1, 0),
      startTime: Date.now(),
      duration: 300,
      onComplete: () => {
        controls.targetRotationX = targetRotX;
        controls.targetRotationY = targetRotY;
        saveCameraState(cameraRef, targetRef, cameraControlsRef);
      },
    };
  }, []);

  // ── Main Three.js setup ───────────────────────────────────────────────────

  useViewportInit({
    containerRef,
    sceneRef,
    cameraRef,
    rendererRef,
    objectsRef,
    planeRef,
    shadowGroundRef,
    shadowLightRef,
    targetRef,
    raycasterRef,
    mouseRef,
    cameraControlsRef,
    handlesRef,
    handleDragRef,
    transformDebounceRef,
    boundingBoxRef,
    axisGroupRef,
    composerRef,
    envTextureRef,
    faceHighlightRef,
    edgeHighlightRef,
    pointHighlightRef,
    subGeoHighlightGroupRef,
    sketchModeRef,
    savedCameraStateRef,
    sketchGridGroupRef,
    cameraAnimRef,
    sketchPlacementModeRef,
    sketchPlacementPlanesRef,
    extrudeSelectModeRef,
    extrudeSelectGroupRef,
    sketchDrawRef,
    sketchShapesGroupRef,
    dimHintRef,
    propagateConstraintsRef,
    activeSketchToolRef,
    selectedIdRef,
    selectedIdsRef,
    itemsRef,
    theme,
    projectionMode,
    setHoveredId,
    selectItem,
    setSketchDrawPhase,
    setSketchMode,
    setRotationState,
  });

  useEffect(() => {
    if (axisGroupRef.current)
      axisGroupRef.current.visible = axisVisible && !sketchModeRef.current;
  }, [axisVisible]);

  // Toggle ground-plane shadows.  The directional light and the
  // ShadowMaterial receiver-plane are both gated by the same flag so
  // turning shadows off skips the shadow-map render and hides the
  // tinted plane.  shadowMap on the renderer stays enabled — flipping
  // that at runtime forces every material to recompile.
  useEffect(() => {
    if (shadowLightRef.current)
      shadowLightRef.current.castShadow = shadowsEnabled;
    if (shadowGroundRef.current)
      shadowGroundRef.current.visible = shadowsEnabled;
  }, [shadowsEnabled]);

  // Global Escape → cancel any in-progress extrude.  Captures the event
  // BEFORE the form input's own handler so the cancel fires even when
  // the depth-overlay FormulaInput has focus and its autocomplete
  // popup would otherwise swallow the Escape.
  useEffect(() => {
    const handler = (e) => {
      if (e.key !== "Escape") return;
      if (!useStore.getState().extrudeSelectMode) return;
      cameraControlsRef.current?.cancelExtrude?.();
    };
    document.addEventListener("keydown", handler, true); // capture phase
    return () => document.removeEventListener("keydown", handler, true);
  }, []);

  // ── Projection mode switch ────────────────────────────────────────────────

  useEffect(() => {
    if (!cameraRef.current || !containerRef.current || !rendererRef.current)
      return;
    const container = containerRef.current;
    const renderer = rendererRef.current;
    const currentCamera = cameraRef.current;
    const currentRotX = cameraControlsRef.current.targetRotationX;
    const currentRotY = cameraControlsRef.current.targetRotationY;
    const currentPosition = currentCamera.position.clone();
    const aspect = container.clientWidth / container.clientHeight;
    const frustumSize = 20;
    let newCamera;
    if (projectionMode === "isometric") {
      newCamera = new THREE.OrthographicCamera(
        (-frustumSize * aspect) / 2,
        (frustumSize * aspect) / 2,
        frustumSize / 2,
        -frustumSize / 2,
        0.1,
        1000,
      );
      const distance = Math.max(
        10,
        currentPosition.distanceTo(targetRef.current),
      );
      newCamera.position.set(
        targetRef.current.x +
          Math.sin(currentRotY) * Math.cos(currentRotX) * distance,
        targetRef.current.y + Math.sin(currentRotX) * distance,
        targetRef.current.z +
          Math.cos(currentRotY) * Math.cos(currentRotX) * distance,
      );
    } else {
      newCamera = new THREE.PerspectiveCamera(30, aspect, 0.1, 1000);
      newCamera.position.copy(currentPosition);
    }
    newCamera.lookAt(targetRef.current);
    currentCamera.children.forEach((child) => {
      if (child instanceof THREE.Light) {
        currentCamera.remove(child);
        newCamera.add(child);
      }
    });
    sceneRef.current.remove(currentCamera);
    sceneRef.current.add(newCamera);
    cameraRef.current = newCamera;
    if (composerRef.current && composerRef.current.passes.length > 0)
      composerRef.current.passes[0].camera = newCamera;
    renderer.clear();
    renderer.render(sceneRef.current, newCamera);
  }, [projectionMode]);

  // ── Camera reset ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (
      !cameraRef.current ||
      !cameraControlsRef.current ||
      cameraResetTrigger === 0
    )
      return;
    const camera = cameraRef.current;
    const controls = cameraControlsRef.current;
    targetRef.current.set(0, 0, 0);
    controls.targetRotationX = Math.asin(Math.sqrt(1 / 3));
    controls.targetRotationY = Math.PI / 4;
    camera.position.set(10, 10, 10);
    camera.lookAt(targetRef.current);
    setRotationState(camera.quaternion.clone());
  }, [cameraResetTrigger]);

  // ── Sketch placement planes ───────────────────────────────────────────────

  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;
    const clearPlanes = () => {
      sketchPlacementPlanesRef.current.forEach(({ mesh }) => {
        scene.remove(mesh);
        mesh.geometry.dispose();
        mesh.material.dispose();
      });
      sketchPlacementPlanesRef.current = [];
    };
    clearPlanes();
    if (!sketchPlacementMode) return;
    const center = targetRef.current.clone();
    const SIZE = 8;
    [
      { name: "XZ", rx: -Math.PI / 2, ry: 0, rz: 0, color: 0x4488ff },
      { name: "XY", rx: 0, ry: 0, rz: 0, color: 0x44bb44 },
      { name: "YZ", rx: 0, ry: Math.PI / 2, rz: 0, color: 0xff4444 },
    ].forEach(({ name, rx, ry, rz, color }) => {
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(SIZE, SIZE),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      mesh.position.copy(center);
      mesh.rotation.set(rx, ry, rz);
      scene.add(mesh);
      sketchPlacementPlanesRef.current.push({
        mesh,
        euler: { x: rx, y: ry, z: rz },
        name,
      });
    });
    return clearPlanes;
  }, [sketchPlacementMode]);

  // ── Regenerate CSG/bevel results at the current resolution ───────────────
  // CSG and bevel items store a `regenerator` describing how they were made.
  // When the user toggles preview/print, walk items and re-run any whose
  // baked geometryData was computed at the old precision.  This is what
  // makes the scene "recalculate to the current timeline position" — the
  // baked geometryData gets refreshed for the current setting before the
  // scene rebuild reads from items.
  useEffect(() => {
    // The orchestrator is a UI-only module that's never reachable from
    // the OCC worker's transitive imports, so it can route per-item regen
    // through occClient → worker without creating a bundling cycle.
    import("../three/regenerateOrchestrator.js").then((m) => {
      m.regenerateForResolution(printPrecision);
    });
    // Variables drive extrude depth and dimension distances via formula
    // resolution; re-run when they change so geometry/labels reflect the
    // new values.
  }, [items, curveResolution, variables]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Rebuild scene objects ─────────────────────────────────────────────────

  useEffect(() => {
    if (!sceneRef.current || !rendererRef.current) return;
    buildSceneObjects(
      items,
      sceneRef.current,
      objectsRef,
      originalMaterialsRef,
      curveSegments,
      printPrecision,
    );
    applyRenderMode(renderMode, {
      scene: sceneRef.current,
      renderer: rendererRef.current,
      cameraRef,
      objectsRef,
      originalMaterialsRef,
      itemsRef,
      axisGroupRef,
      planeRef,
      sketchPlacementPlanesRef,
      composerRef,
      envTextureRef,
      sketchModeRef,
      printPrecision,
    });
    // Variables drive extrude depth and dimension distances via formula
    // resolution; re-run when they change so geometry/labels reflect the
    // new values.
  }, [items, curveResolution, variables]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Persistent sub-geometry selection highlights ─────────────────────────
  // Rebuild a darker-coloured overlay whenever the selected faces or edges
  // change, so the user can see what they have committed to selection
  // (distinct from the brighter hover highlight).

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const renderer = rendererRef.current;
    const resolution = renderer
      ? renderer.getSize(new THREE.Vector2())
      : undefined;
    subGeoHighlightGroupRef.current = reconcileSelectionHighlight(
      scene,
      subGeoHighlightGroupRef.current,
      selectedSubGeometry,
      objectsRef.current,
      items,
      { resolution },
    );
  }, [selectedSubGeometry, items]);

  // ── Transform handles + bounding box ─────────────────────────────────────

  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;

    handlesRef.current.forEach(({ mesh }) => {
      scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    handlesRef.current = [];
    handleDragRef.current = null;

    if (boundingBoxRef.current) {
      const { boxMesh, labelX, labelY, labelZ } = boundingBoxRef.current;
      scene.remove(boxMesh);
      scene.remove(labelX.sprite);
      scene.remove(labelY.sprite);
      scene.remove(labelZ.sprite);
      boxMesh.geometry.dispose();
      boxMesh.material.dispose();
      labelX.mat.map.dispose();
      labelX.mat.dispose();
      labelY.mat.map.dispose();
      labelY.mat.dispose();
      labelZ.mat.map.dispose();
      labelZ.mat.dispose();
      boundingBoxRef.current = null;
    }

    if (!selectedId) return;
    if (selectedIdsRef.current.length > 1) return;

    const result = buildTransformHandles(selectedId, items, objectsRef);
    if (!result) return;

    const { handles, boundingBox } = result;
    handles.forEach(({ mesh }) => scene.add(mesh));
    scene.add(boundingBox.boxMesh);
    scene.add(boundingBox.labelX.sprite);
    scene.add(boundingBox.labelY.sprite);
    scene.add(boundingBox.labelZ.sprite);
    handlesRef.current = handles;
    boundingBoxRef.current = boundingBox;

    return () => {
      handlesRef.current.forEach(({ mesh: hm }) => {
        if (sceneRef.current) sceneRef.current.remove(hm);
        hm.geometry.dispose();
        hm.material.dispose();
      });
      handlesRef.current = [];
      if (boundingBoxRef.current) {
        const {
          boxMesh,
          labelX: lx,
          labelY: ly,
          labelZ: lz,
        } = boundingBoxRef.current;
        if (sceneRef.current) {
          sceneRef.current.remove(boxMesh);
          sceneRef.current.remove(lx.sprite);
          sceneRef.current.remove(ly.sprite);
          sceneRef.current.remove(lz.sprite);
        }
        boxMesh.geometry.dispose();
        boxMesh.material.dispose();
        lx.mat.map.dispose();
        lx.mat.dispose();
        ly.mat.map.dispose();
        ly.mat.dispose();
        lz.mat.map.dispose();
        lz.mat.dispose();
        boundingBoxRef.current = null;
      }
    };
  }, [selectedId, items]);

  // ── Sketch mode (top-down view + grid) ───────────────────────────────────

  useSketchModeEffect({
    sceneRef,
    cameraRef,
    rendererRef,
    cameraControlsRef,
    objectsRef,
    originalMaterialsRef,
    itemsRef,
    axisGroupRef,
    planeRef,
    sketchPlacementPlanesRef,
    composerRef,
    envTextureRef,
    sketchModeRef,
    sketchDrawRef,
    sketchShapesGroupRef,
    sketchGhostGroupRef,
    sketchGridGroupRef,
    savedCameraStateRef,
    cameraAnimRef,
    targetRef,
    dimHintRef,
    preSketchProjectionRef,
    setSketchMode,
    setSketchDrawPhase,
    setRotationState,
    selectedId,
    items,
    projectionMode,
    printPrecision,
  });

  // ── Sketch shape lines ────────────────────────────────────────────────────

  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;
    if (sketchShapesGroupRef.current) {
      scene.remove(sketchShapesGroupRef.current);
      sketchShapesGroupRef.current.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      sketchShapesGroupRef.current = null;
    }
    const group = buildSketchShapesGroup(
      selectedId,
      items,
      objectsRef,
      rendererRef.current,
      constraintsVisible,
      dimensionsVisible,
      curveSegments,
      printPrecision,
    );
    if (group) {
      if (renderMode === "smooth") group.visible = false;
      scene.add(group);
      sketchShapesGroupRef.current = group;
    }
  }, [
    selectedId,
    items,
    constraintsVisible,
    dimensionsVisible,
    curveResolution,
  ]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Object-view sketch construction lines ────────────────────────────────

  useEffect(() => {
    if (!sceneRef.current || !rendererRef.current) return;
    const scene = sceneRef.current;
    if (allSketchGroupRef.current) {
      scene.remove(allSketchGroupRef.current);
      allSketchGroupRef.current.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      allSketchGroupRef.current = null;
    }
    if (sketchMode) return;
    const group = buildAllSketchShapesGroup(
      items,
      objectsRef,
      rendererRef.current,
    );
    if (group) {
      if (renderMode === "smooth") group.visible = false;
      scene.add(group);
      allSketchGroupRef.current = group;
    }
  }, [items, sketchMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Extrude profile selection fills ──────────────────────────────────────

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (extrudeSelectGroupRef.current) {
      scene.remove(extrudeSelectGroupRef.current);
      extrudeSelectGroupRef.current.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      extrudeSelectGroupRef.current = null;
    }
    if (extrudeSelectMode === "profile") {
      const group = buildExtrudeSelectGroup(
        items,
        objectsRef,
        curveSegments,
        printPrecision,
      );
      if (group) {
        scene.add(group);
        extrudeSelectGroupRef.current = group;
      }
    }
  }, [extrudeSelectMode, items, curveResolution]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Emissive highlight ────────────────────────────────────────────────────

  useEffect(() => {
    updateEmissive(objectsRef, selectedId, selectedIds, hoveredId);
  }, [hoveredId, selectedId, selectedIds]);

  // ── Render mode ───────────────────────────────────────────────────────────
  // Also re-runs on curveResolution changes so the wireframe (and the
  // primitive shader vs. wireframe swap) picks up the new chord-deviation
  // precision and matches the smooth shader / CSG / bevel resolution.

  useEffect(() => {
    if (!sceneRef.current || !rendererRef.current) return;
    applyRenderMode(renderMode, {
      scene: sceneRef.current,
      renderer: rendererRef.current,
      cameraRef,
      objectsRef,
      originalMaterialsRef,
      itemsRef,
      axisGroupRef,
      planeRef,
      sketchPlacementPlanesRef,
      composerRef,
      envTextureRef,
      sketchModeRef,
      printPrecision,
    });
    const isSmooth = renderMode === "smooth";
    if (allSketchGroupRef.current)
      allSketchGroupRef.current.visible = !isSmooth;
    if (sketchShapesGroupRef.current)
      sketchShapesGroupRef.current.visible = !isSmooth;
  }, [renderMode, curveResolution]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="viewport-container">
      <div
        ref={containerRef}
        className="viewport"
        style={
          sketchPlacementMode || activeSketchTool
            ? { cursor: "crosshair" }
            : undefined
        }
      />
      <BusyIndicator />
      <SketchOverlays
        sketchPlacementMode={sketchPlacementMode}
        extrudeSelectMode={extrudeSelectMode}
        extrudeDepthInput={extrudeDepthInput}
        activeSketchTool={activeSketchTool}
        sketchDrawPhase={sketchDrawPhase}
        sketchMode={sketchMode}
        sketchConstraintMode={sketchConstraintMode}
        sketchConstraintFirstPoint={sketchConstraintFirstPoint}
        sketchModifyMode={sketchModifyMode}
        sketchDistanceInput={sketchDistanceInput}
        isInSketchMode={isInSketchMode}
        selectedId={selectedId}
        variables={variables}
        cameraControlsRef={cameraControlsRef}
        dimHintRef={dimHintRef}
        itemsRef={itemsRef}
        propagateConstraintsRef={propagateConstraintsRef}
        selectItem={selectItem}
      />
      {widgetVisible && (
        <RotationWidget
          rotationState={rotationState}
          onOrientationChange={sketchMode ? null : handleOrientationChange}
          style={
            sketchMode ? { pointerEvents: "none", opacity: 0.35 } : undefined
          }
        />
      )}
    </div>
  );
};

export default Viewport;
