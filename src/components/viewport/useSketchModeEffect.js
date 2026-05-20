// Manages the lifecycle of "sketch mode" — what happens when the
// selected item is a sketch.  Entering: save the user's camera state,
// force isometric projection, animate a fly-in to the sketch plane,
// build the grid + axis overlay, and re-run applyRenderMode so 3D
// geometry behind the active sketch becomes see-through.  Leaving:
// dispose the grid + preview overlays, restore the saved camera, and
// rebuild scene objects so any downstream extrudes pick up the latest
// sketch shapes.

import { useEffect } from "react";
import * as THREE from "three";
import {
  buildSceneObjects,
  applyRenderMode,
} from "../../three/sceneObjects.js";
import { useStore } from "../../store";

export function useSketchModeEffect({
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
}) {
  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;
    const selectedItem = items.find((i) => i.id === selectedId);
    const isSketch = selectedItem && selectedItem.type === "sketch";

    const clearSketchGrid = () => {
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
    };

    if (!isSketch) {
      if (sketchModeRef.current) {
        sketchModeRef.current = false;
        setSketchMode(false);
        if (sketchDrawRef.current) {
          sketchDrawRef.current.previewObjects.forEach((obj) => {
            scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
          });
          sketchDrawRef.current = null;
        }
        if (dimHintRef.current) dimHintRef.current.style.display = "none";
        setSketchDrawPhase(null);
        useStore.getState().setActiveSketchTool(null);
        if (sketchShapesGroupRef.current) {
          scene.remove(sketchShapesGroupRef.current);
          sketchShapesGroupRef.current.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
          });
          sketchShapesGroupRef.current = null;
        }
        if (sketchGhostGroupRef.current) {
          scene.remove(sketchGhostGroupRef.current);
          sketchGhostGroupRef.current.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
          });
          sketchGhostGroupRef.current = null;
        }
        if (axisGroupRef.current)
          axisGroupRef.current.visible = useStore.getState().axisVisible;
        if (planeRef.current) planeRef.current.visible = true;
        // Restore the projection mode the user had selected before
        // entering sketch mode.  Sketch mode forces isometric so the
        // sketch plane sits flat with no perspective distortion.
        if (
          preSketchProjectionRef.current &&
          preSketchProjectionRef.current !== "isometric"
        ) {
          useStore.getState().setProjectionMode(preSketchProjectionRef.current);
        }
        preSketchProjectionRef.current = null;
        // Rebuild scene objects so any sketch-dependent geometry (e.g. extrudes)
        // picks up the latest sketch shapes before becoming visible again.
        buildSceneObjects(
          itemsRef.current,
          scene,
          objectsRef,
          originalMaterialsRef,
        );
        applyRenderMode(useStore.getState().renderMode, {
          scene,
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
          printPrecision:
            useStore.getState().curveResolution === "print" ? 0.01 : null,
        });
        clearSketchGrid();
        const saved = savedCameraStateRef.current;
        if (saved && cameraRef.current && cameraControlsRef.current) {
          const camera = cameraRef.current;
          const controls = cameraControlsRef.current;
          cameraAnimRef.current = {
            startPos: camera.position.clone(),
            endPos: new THREE.Vector3(
              saved.positionX,
              saved.positionY,
              saved.positionZ,
            ),
            startTarget: targetRef.current.clone(),
            endTarget: new THREE.Vector3(
              saved.targetX,
              saved.targetY,
              saved.targetZ,
            ),
            startUp: camera.up.clone(),
            endUp: new THREE.Vector3(0, 1, 0),
            startTime: Date.now(),
            duration: 500,
            onComplete: () => {
              cameraRef.current.up.set(0, 1, 0);
              controls.targetRotationX = saved.rotationX;
              controls.targetRotationY = saved.rotationY;
              setRotationState(cameraRef.current.quaternion.clone());
              savedCameraStateRef.current = null;
            },
          };
        }
      }
      return;
    }

    const mesh = objectsRef.current[selectedId];
    if (!mesh) return;

    if (!sketchModeRef.current) {
      if (cameraRef.current && cameraControlsRef.current) {
        const camera = cameraRef.current;
        const controls = cameraControlsRef.current;
        savedCameraStateRef.current = {
          positionX: camera.position.x,
          positionY: camera.position.y,
          positionZ: camera.position.z,
          targetX: targetRef.current.x,
          targetY: targetRef.current.y,
          targetZ: targetRef.current.z,
          rotationX: controls.targetRotationX,
          rotationY: controls.targetRotationY,
        };
      }
      sketchModeRef.current = true;
      setSketchMode(true);
      if (axisGroupRef.current) axisGroupRef.current.visible = false;
      // Re-run applyRenderMode so the new sketchModeRef.current=true is
      // observed: 3D geometry becomes see-through and the active sketch
      // plane drops to ~0.05 opacity instead of being hidden.  The
      // previous code hid every mesh + projected edge-ghosts onto the
      // sketch plane — now the real geometry stays visible behind the
      // sketch, no ghost projection needed.
      preSketchProjectionRef.current = projectionMode;
      if (projectionMode !== "isometric") {
        useStore.getState().setProjectionMode("isometric");
      }
      applyRenderMode(useStore.getState().renderMode, {
        scene,
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

      // Camera fly-in to the sketch plane.  This MUST be inside the
      // first-entry guard — the surrounding effect's dependency array
      // includes `items`, so without the guard every sketch-shape add
      // would re-trigger this animation and jump the camera.
      const worldNormal = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(mesh.quaternion)
        .normalize();
      const worldUp = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(mesh.quaternion)
        .normalize();
      const meshCenter = mesh.position.clone();
      const camPos = meshCenter.clone().addScaledVector(worldNormal, 15);
      if (cameraRef.current && cameraControlsRef.current) {
        const camera = cameraRef.current;
        const controls = cameraControlsRef.current;
        cameraAnimRef.current = {
          startPos: camera.position.clone(),
          endPos: camPos.clone(),
          startTarget: targetRef.current.clone(),
          endTarget: meshCenter.clone(),
          startUp: camera.up.clone(),
          endUp: worldUp.clone(),
          startTime: Date.now(),
          duration: 500,
          onComplete: () => {
            cameraRef.current.up.copy(worldUp);
            const dp = camPos.clone().sub(meshCenter);
            const dist = dp.length();
            controls.targetRotationX =
              dist > 0 ? Math.asin(Math.max(-1, Math.min(1, dp.y / dist))) : 0;
            controls.targetRotationY = Math.atan2(dp.x, dp.z);
            setRotationState(cameraRef.current.quaternion.clone());
          },
        };
      }
    }

    if (planeRef.current) planeRef.current.visible = false;
    // Note: we no longer hide every mesh here.  applyRenderMode (re-run
    // above when entering sketch mode) handles the transparency / sketch
    // plane visibility — keeping the 3D geometry visible behind the
    // active sketch plane.

    clearSketchGrid();
    const GRID_HALF = 25;
    const gridGroup = new THREE.Group();
    gridGroup.frustumCulled = false;

    // Minor grid (repositioned each frame to follow camera)
    const minorGridGroup = new THREE.Group();
    minorGridGroup.frustumCulled = false;
    const makeGridLine = (a, b) => {
      const l = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({
          color: 0x445566,
          transparent: true,
          opacity: 0.45,
          depthTest: false,
        }),
      );
      l.frustumCulled = false;
      l.renderOrder = 990;
      return l;
    };
    for (let i = -GRID_HALF; i <= GRID_HALF; i++) {
      if (i === 0) continue;
      minorGridGroup.add(
        makeGridLine(
          new THREE.Vector3(i, -GRID_HALF, 0),
          new THREE.Vector3(i, GRID_HALF, 0),
        ),
      );
      minorGridGroup.add(
        makeGridLine(
          new THREE.Vector3(-GRID_HALF, i, 0),
          new THREE.Vector3(GRID_HALF, i, 0),
        ),
      );
    }
    gridGroup.add(minorGridGroup);
    gridGroup.userData.minorGrid = minorGridGroup;

    // Axis lines — long enough to always cross the screen
    const AXIS_HALF = 500;
    const makeAxis = (a, b, col) => {
      const l = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        new THREE.LineBasicMaterial({ color: col, depthTest: false }),
      );
      l.frustumCulled = false;
      l.renderOrder = 991;
      return l;
    };
    gridGroup.add(
      makeAxis(
        new THREE.Vector3(-AXIS_HALF, 0, 0),
        new THREE.Vector3(AXIS_HALF, 0, 0),
        0xff4444,
      ),
    );
    gridGroup.add(
      makeAxis(
        new THREE.Vector3(0, -AXIS_HALF, 0),
        new THREE.Vector3(0, AXIS_HALF, 0),
        0x4488ff,
      ),
    );

    gridGroup.position.copy(mesh.position);
    gridGroup.quaternion.copy(mesh.quaternion);
    scene.add(gridGroup);
    sketchGridGroupRef.current = gridGroup;
  }, [selectedId, items]); // eslint-disable-line react-hooks/exhaustive-deps
}
