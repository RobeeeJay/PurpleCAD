import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import RotationWidget from "./RotationWidget";
import BusyIndicator from "./BusyIndicator";
import PathTraceProgress from "./PathTraceProgress";
import SketchOverlays from "./viewport/SketchOverlays";
import ChamferOverlay from "./viewport/ChamferOverlay";
import PushPullOverlay from "./viewport/PushPullOverlay";
import SweepOverlay from "./viewport/SweepOverlay";
import SvgPlacementOverlay from "./viewport/SvgPlacementOverlay";
import PlaneDialog from "./PlaneDialog";
import MirrorDialog from "./MirrorDialog";
import Pattern3dDialog from "./Pattern3dDialog";
import SplitDialog from "./SplitDialog";
import ShellDialog from "./ShellDialog";
import OriginDialog from "./OriginDialog";
import HoleDialog from "./HoleDialog";
import EmbossDialog from "./EmbossDialog";
import DraftDialog from "./DraftDialog";
import PointToPointDialog from "./PointToPointDialog";
import SelectionWidget from "./SelectionWidget";
import PlanePickHint from "./viewport/PlanePickHint";
import { useViewportInit } from "./viewport/useViewportInit";
import { useViewportCamera } from "./viewport/useViewportCamera";
import { useSceneSync } from "./viewport/useSceneSync";
import "../styles/Viewport.css";
import { useStore } from "../store";
import { activePrecision } from "../three/resolution.js";

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
  const sweepSelectModeRef = useRef(null);
  const sketchDrawRef = useRef(null);
  const sketchShapesGroupRef = useRef(null);
  const allSketchGroupRef = useRef(null);
  const sketchGhostGroupRef = useRef(null);
  // Remembers the user's projection setting from before entering sketch
  // mode so it can be restored on exit.  Sketch mode forces orthographic
  // (orthographic) projection so the sketch plane has no perspective
  // distortion.
  const preSketchProjectionRef = useRef(null);
  // Remembers the user's render mode from before an extrude began so it
  // can be restored on confirm / cancel.  Extrude mode temporarily
  // forces "transparent" so the user can see through the source solid
  // to gauge the depth and direction of the cut/extrusion.
  const preExtrudeRenderModeRef = useRef(null);
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
  const crossSectionView = useStore((state) => state.crossSectionView);
  const pathTraceView = useStore((state) => state.pathTraceView);
  const projectionMode = useStore((state) => state.projectionMode);
  const fov = useStore((state) => state.fov);
  const widgetVisible = useStore((state) => state.widgetVisible);
  const axisVisible = useStore((state) => state.axisVisible);
  const cameraResetTrigger = useStore((state) => state.cameraResetTrigger);
  const sketchPlacementMode = useStore((state) => state.sketchPlacementMode);
  const extrudeSelectMode = useStore((state) => state.extrudeSelectMode);
  const sweepSelectMode = useStore((state) => state.sweepSelectMode);
  const cutExtrudeInProgress = useStore((state) => state.cutExtrudeInProgress);
  const extrudeDepthInput = useStore((state) => state.extrudeDepthInput);
  const activeSketchTool = useStore((state) => state.activeSketchTool);
  const sketchConstraintMode = useStore((state) => state.sketchConstraintMode);
  const sketchConstraintFirstPoint = useStore(
    (state) => state.sketchConstraintFirstPoint,
  );
  const sketchModifyMode = useStore((state) => state.sketchModifyMode);
  const sketchDistanceInput = useStore((state) => state.sketchDistanceInput);
  const sketchMirrorState = useStore((state) => state.sketchMirrorState);
  const sketchCircularPatternState = useStore(
    (state) => state.sketchCircularPatternState,
  );
  const sketchRectangularPatternState = useStore(
    (state) => state.sketchRectangularPatternState,
  );
  const constraintsVisible = useStore((state) => state.constraintsVisible);
  const dimensionsVisible = useStore((state) => state.dimensionsVisible);
  const selectedSubGeometry = useStore((state) => state.selectedSubGeometry);
  const curveSegments = 32;
  const printPrecision = useStore(activePrecision);

  const _selItem = items.find((i) => i.id === selectedId);
  const isInSketchMode = _selItem != null && _selItem.type === "sketch";

  selectedIdRef.current = selectedId;
  selectedIdsRef.current = selectedIds;
  itemsRef.current = items;
  sketchPlacementModeRef.current = sketchPlacementMode;
  activeSketchToolRef.current = activeSketchTool;
  extrudeSelectModeRef.current = extrudeSelectMode;
  sweepSelectModeRef.current = sweepSelectMode ? sweepSelectMode.kind : null;

  const { handleOrientationChange, handleHome } = useViewportCamera({
    containerRef,
    sceneRef,
    cameraRef,
    rendererRef,
    cameraControlsRef,
    targetRef,
    cameraAnimRef,
    composerRef,
    objectsRef,
    itemsRef,
    projectionMode,
    fov,
    isInSketchMode,
    cameraResetTrigger,
    setRotationState,
  });

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
    sweepSelectModeRef,
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

  useSceneSync({
    sceneRef,
    cameraRef,
    rendererRef,
    cameraControlsRef,
    objectsRef,
    originalMaterialsRef,
    planeRef,
    shadowGroundRef,
    shadowLightRef,
    targetRef,
    axisGroupRef,
    composerRef,
    envTextureRef,
    sketchModeRef,
    sketchPlacementPlanesRef,
    subGeoHighlightGroupRef,
    handlesRef,
    handleDragRef,
    boundingBoxRef,
    sketchShapesGroupRef,
    allSketchGroupRef,
    sketchGhostGroupRef,
    sketchGridGroupRef,
    extrudeSelectGroupRef,
    preSketchProjectionRef,
    preExtrudeRenderModeRef,
    dimHintRef,
    savedCameraStateRef,
    cameraAnimRef,
    sketchDrawRef,
    itemsRef,
    selectedIdsRef,
    items,
    variables,
    renderMode,
    selectedId,
    selectedIds,
    selectedSubGeometry,
    constraintsVisible,
    dimensionsVisible,
    sketchMode,
    sketchPlacementMode,
    extrudeSelectMode,
    sweepSelectMode,
    cutExtrudeInProgress,
    hoveredId,
    projectionMode,
    axisVisible,
    shadowsEnabled,
    crossSectionView,
    pathTraceView,
    curveSegments,
    printPrecision,
    activeSketchTool,
    setSketchMode,
    setSketchDrawPhase,
    setRotationState,
  });

  return (
    <div className="viewport-container">
      <div
        ref={containerRef}
        className="viewport"
        style={
          sketchPlacementMode || activeSketchTool || sweepSelectMode
            ? { cursor: "crosshair" }
            : undefined
        }
      />
      <BusyIndicator />
      <PathTraceProgress />
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
        sketchMirrorState={sketchMirrorState}
        sketchCircularPatternState={sketchCircularPatternState}
        sketchRectangularPatternState={sketchRectangularPatternState}
        isInSketchMode={isInSketchMode}
        selectedId={selectedId}
        variables={variables}
        cameraControlsRef={cameraControlsRef}
        cameraRef={cameraRef}
        rendererRef={rendererRef}
        objectsRef={objectsRef}
        dimHintRef={dimHintRef}
        itemsRef={itemsRef}
        propagateConstraintsRef={propagateConstraintsRef}
        selectItem={selectItem}
      />
      <ChamferOverlay />
      <PushPullOverlay />
      <SweepOverlay />
      <PlaneDialog />
      <MirrorDialog />
      <Pattern3dDialog />
      <SplitDialog />
      <ShellDialog />
      <OriginDialog />
      <HoleDialog />
      <EmbossDialog />
      <DraftDialog />
      <PointToPointDialog />
      <SelectionWidget />
      <SvgPlacementOverlay />
      <PlanePickHint />
      {widgetVisible && (
        <RotationWidget
          rotationState={rotationState}
          onOrientationChange={sketchMode ? null : handleOrientationChange}
          onHome={sketchMode ? null : handleHome}
          style={
            sketchMode ? { pointerEvents: "none", opacity: 0.35 } : undefined
          }
        />
      )}
    </div>
  );
};

export default Viewport;
