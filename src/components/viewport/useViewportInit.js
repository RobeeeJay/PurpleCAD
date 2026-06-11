// One-shot scene bootstrap.  Builds the Three.js scene, camera,
// renderer, lights, grid, axis indicator, orbit indicator; wires up
// the camera-controls layer; and returns a cleanup that disposes
// everything when Viewport unmounts (or theme changes).  Lives here
// so the Viewport component body stays focused on per-state useEffect
// orchestration rather than the long initial-setup sequence.

import { useEffect } from "react";
import * as THREE from "three";
import {
  createScene,
  createCamera,
  createRenderer,
  createLights,
  createGrid,
  createAxisGroup,
  createOrbitIndicator,
  createShadowGround,
  setupResize,
} from "../../three/sceneSetup.js";
import {
  loadCameraState,
  saveCameraState,
  attachCameraControls,
} from "../../three/cameraControls.js";
import { useStore } from "../../store";

export function useViewportInit({
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
}) {
  useEffect(() => {
    if (!containerRef.current) return;
    const savedState = loadCameraState();

    const scene = createScene(theme);
    sceneRef.current = scene;

    const aspect =
      containerRef.current.clientWidth / containerRef.current.clientHeight;
    const savedTarget = new THREE.Vector3(
      savedState.targetX,
      savedState.targetY,
      savedState.targetZ,
    );
    targetRef.current.copy(savedTarget);

    const camera = createCamera(
      projectionMode,
      aspect,
      savedState,
      targetRef,
      useStore.getState().fov,
    );
    cameraRef.current = camera;
    scene.add(camera);

    const controls = cameraControlsRef.current;
    // Expose this controls object to non-Viewport components (the toolbar
    // calls dropSelectedToGround through here).
    useStore.getState().setCameraControls(controls);
    const px = savedState.positionX - savedState.targetX;
    const py = savedState.positionY - savedState.targetY;
    const pz = savedState.positionZ - savedState.targetZ;
    const dist = Math.sqrt(px * px + py * py + pz * pz);
    controls.targetRotationX =
      dist > 0 ? Math.asin(Math.max(-1, Math.min(1, py / dist))) : 0;
    controls.targetRotationY = Math.atan2(px, pz);
    setRotationState(camera.quaternion.clone());

    const renderer = createRenderer(containerRef.current);
    rendererRef.current = renderer;

    const { dir1: shadowLight } = createLights(scene, camera);
    shadowLightRef.current = shadowLight;
    shadowGroundRef.current = createShadowGround(scene);
    const { gridPlane, gridMaterial, rulerGroup } = createGrid(scene);
    planeRef.current = gridPlane;
    axisGroupRef.current = createAxisGroup(scene);
    axisGroupRef.current.visible = useStore.getState().axisVisible;

    const {
      mesh: orbitIndicator,
      geo: orbitGeo,
      mat: orbitMat,
    } = createOrbitIndicator(scene);
    const cleanupResize = setupResize(
      containerRef,
      cameraRef,
      renderer,
      composerRef,
    );

    const cleanupControls = attachCameraControls({
      renderer,
      scene,
      sceneRef,
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
      propagateConstraintsRef,
    });

    return () => {
      cleanupControls();
      cleanupResize();
      orbitGeo.dispose();
      orbitMat.dispose();
      [faceHighlightRef, edgeHighlightRef, pointHighlightRef].forEach((ref) => {
        if (ref.current) {
          ref.current.geometry.dispose();
          ref.current.material.dispose();
          ref.current = null;
        }
      });
      if (subGeoHighlightGroupRef.current) {
        subGeoHighlightGroupRef.current.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
        subGeoHighlightGroupRef.current = null;
      }
      if (transformDebounceRef.current)
        clearTimeout(transformDebounceRef.current);
      rulerGroup.traverse((obj) => {
        if (obj.material) {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      });
      saveCameraState(cameraRef, targetRef, cameraControlsRef);
      if (composerRef.current) {
        composerRef.current.dispose();
        composerRef.current = null;
      }
      if (envTextureRef.current) {
        envTextureRef.current.dispose();
        envTextureRef.current = null;
      }
      if (axisGroupRef.current) {
        axisGroupRef.current.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (obj.material.map) obj.material.map.dispose();
            obj.material.dispose();
          }
        });
        axisGroupRef.current = null;
      }
      if (sketchGridGroupRef.current) {
        scene.remove(sketchGridGroupRef.current);
        sketchGridGroupRef.current.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) {
            if (obj.material.map) obj.material.map.dispose();
            obj.material.dispose();
          }
        });
        sketchGridGroupRef.current = null;
      }
      sketchModeRef.current = false;
      setSketchMode(false);
      if (containerRef.current)
        containerRef.current.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [theme, setHoveredId]); // eslint-disable-line react-hooks/exhaustive-deps
}
