import React, { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import RotationWidget from "./RotationWidget";
import "../styles/Viewport.css";
import { useStore } from "../store";
import { createScene, createCamera, createRenderer, createLights, createGrid, createAxisGroup, createOrbitIndicator, setupResize } from "../three/sceneSetup.js";
import { updateEmissive } from "../three/objectMaterials.js";
import { buildSceneObjects, buildTransformHandles, buildSketchShapesGroup, applyRenderMode, makeMeasureLabel, MM_PER_UNIT, placeDimLabels } from "../three/sceneObjects.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { loadCameraState, saveCameraState, attachCameraControls } from "../three/cameraControls.js";

const Viewport = () => {
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const objectsRef = useRef({});
  const originalMaterialsRef = useRef({});
  const planeRef = useRef(null);
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
  const sketchModeRef = useRef(false);
  const savedCameraStateRef = useRef(null);
  const sketchGridGroupRef = useRef(null);
  const cameraAnimRef = useRef(null);
  const sketchPlacementModeRef = useRef(false);
  const sketchPlacementPlanesRef = useRef([]);
  const sketchDrawRef = useRef(null);
  const sketchShapesGroupRef = useRef(null);
  const dimHintRef = useRef(null);

  const [rotationState, setRotationState] = React.useState(null);
  const [sketchDrawPhase, setSketchDrawPhase] = React.useState(null);

  const selectedIdRef = useRef(null);
  const selectedIdsRef = useRef([]);
  const itemsRef = useRef([]);
  const activeSketchToolRef = useRef(null);

  const items = useStore((state) => state.items);
  const theme = useStore((state) => state.theme);
  const hoveredId = useStore((state) => state.hoveredId);
  const setHoveredId = useStore((state) => state.setHoveredId);
  const selectedId = useStore((state) => state.selectedId);
  const selectedIds = useStore((state) => state.selectedIds);
  const selectItem = useStore((state) => state.selectItem);
  const renderMode = useStore((state) => state.renderMode);
  const projectionMode = useStore((state) => state.projectionMode);
  const widgetVisible = useStore((state) => state.widgetVisible);
  const axisVisible = useStore((state) => state.axisVisible);
  const cameraResetTrigger = useStore((state) => state.cameraResetTrigger);
  const sketchPlacementMode = useStore((state) => state.sketchPlacementMode);
  const activeSketchTool = useStore((state) => state.activeSketchTool);

  const _selItem = items.find((i) => i.id === selectedId);
  const isInSketchMode = _selItem != null && _selItem.type === "sketch";

  selectedIdRef.current = selectedId;
  selectedIdsRef.current = selectedIds;
  itemsRef.current = items;
  sketchPlacementModeRef.current = sketchPlacementMode;
  activeSketchToolRef.current = activeSketchTool;

  const handleOrientationChange = useCallback((targetRotX, targetRotY) => {
    if (!cameraRef.current || !cameraControlsRef.current) return;
    const camera = cameraRef.current;
    const controls = cameraControlsRef.current;
    const distance = camera.position.distanceTo(targetRef.current);
    const endPos = new THREE.Vector3(
      targetRef.current.x + Math.sin(targetRotY) * Math.cos(targetRotX) * distance,
      targetRef.current.y + Math.sin(targetRotX) * distance,
      targetRef.current.z + Math.cos(targetRotY) * Math.cos(targetRotX) * distance,
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

  useEffect(() => {
    if (!containerRef.current) return;
    const savedState = loadCameraState();

    const scene = createScene(theme);
    sceneRef.current = scene;

    const aspect = containerRef.current.clientWidth / containerRef.current.clientHeight;
    const savedTarget = new THREE.Vector3(savedState.targetX, savedState.targetY, savedState.targetZ);
    targetRef.current.copy(savedTarget);

    const camera = createCamera(projectionMode, aspect, savedState, targetRef);
    cameraRef.current = camera;
    scene.add(camera);

    const controls = cameraControlsRef.current;
    const px = savedState.positionX - savedState.targetX;
    const py = savedState.positionY - savedState.targetY;
    const pz = savedState.positionZ - savedState.targetZ;
    const dist = Math.sqrt(px * px + py * py + pz * pz);
    controls.targetRotationX = dist > 0 ? Math.asin(Math.max(-1, Math.min(1, py / dist))) : 0;
    controls.targetRotationY = Math.atan2(px, pz);
    setRotationState(camera.quaternion.clone());

    const renderer = createRenderer(containerRef.current);
    rendererRef.current = renderer;

    createLights(scene, camera);
    const { gridPlane, gridMaterial } = createGrid(scene);
    planeRef.current = gridPlane;
    axisGroupRef.current = createAxisGroup(scene);
    axisGroupRef.current.visible = useStore.getState().axisVisible;

    const { mesh: orbitIndicator, geo: orbitGeo, mat: orbitMat } = createOrbitIndicator(scene);
    const cleanupResize = setupResize(containerRef, cameraRef, renderer, composerRef);

    const cleanupControls = attachCameraControls({
      renderer, scene, sceneRef, cameraRef, targetRef, raycasterRef, mouseRef,
      cameraControlsRef, objectsRef, itemsRef,
      handlesRef, handleDragRef, transformDebounceRef, boundingBoxRef,
      faceHighlightRef, edgeHighlightRef, pointHighlightRef,
      sketchModeRef, sketchDrawRef, sketchPlacementModeRef, sketchPlacementPlanesRef,
      activeSketchToolRef, selectedIdRef, selectedIdsRef, dimHintRef,
      cameraAnimRef, savedCameraStateRef, planeRef, axisGroupRef,
      sketchGridGroupRef, sketchShapesGroupRef,
      orbitIndicator, gridMaterial, composerRef,
      setRotationState, setHoveredId, selectItem, setSketchDrawPhase,
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
      if (transformDebounceRef.current) clearTimeout(transformDebounceRef.current);
      saveCameraState(cameraRef, targetRef, cameraControlsRef);
      if (composerRef.current) { composerRef.current.dispose(); composerRef.current = null; }
      if (envTextureRef.current) { envTextureRef.current.dispose(); envTextureRef.current = null; }
      if (axisGroupRef.current) {
        axisGroupRef.current.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) { if (obj.material.map) obj.material.map.dispose(); obj.material.dispose(); }
        });
        axisGroupRef.current = null;
      }
      if (sketchGridGroupRef.current) {
        scene.remove(sketchGridGroupRef.current);
        sketchGridGroupRef.current.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) { if (obj.material.map) obj.material.map.dispose(); obj.material.dispose(); }
        });
        sketchGridGroupRef.current = null;
      }
      sketchModeRef.current = false;
      if (containerRef.current) containerRef.current.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [theme, setHoveredId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (axisGroupRef.current) axisGroupRef.current.visible = axisVisible;
  }, [axisVisible]);

  // ── Projection mode switch ────────────────────────────────────────────────

  useEffect(() => {
    if (!cameraRef.current || !containerRef.current || !rendererRef.current) return;
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
        (-frustumSize * aspect) / 2, (frustumSize * aspect) / 2,
        frustumSize / 2, -frustumSize / 2, 0.1, 1000,
      );
      const distance = Math.max(10, currentPosition.distanceTo(targetRef.current));
      newCamera.position.set(
        targetRef.current.x + Math.sin(currentRotY) * Math.cos(currentRotX) * distance,
        targetRef.current.y + Math.sin(currentRotX) * distance,
        targetRef.current.z + Math.cos(currentRotY) * Math.cos(currentRotX) * distance,
      );
    } else {
      newCamera = new THREE.PerspectiveCamera(30, aspect, 0.1, 1000);
      newCamera.position.copy(currentPosition);
    }
    newCamera.lookAt(targetRef.current);
    currentCamera.children.forEach((child) => {
      if (child instanceof THREE.Light) { currentCamera.remove(child); newCamera.add(child); }
    });
    sceneRef.current.remove(currentCamera);
    sceneRef.current.add(newCamera);
    cameraRef.current = newCamera;
    if (composerRef.current?.passes.length > 0) composerRef.current.passes[0].camera = newCamera;
    renderer.clear();
    renderer.render(sceneRef.current, newCamera);
  }, [projectionMode]);

  // ── Camera reset ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!cameraRef.current || !cameraControlsRef.current || cameraResetTrigger === 0) return;
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
        scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose();
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
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
      );
      mesh.position.copy(center);
      mesh.rotation.set(rx, ry, rz);
      scene.add(mesh);
      sketchPlacementPlanesRef.current.push({ mesh, euler: { x: rx, y: ry, z: rz }, name });
    });
    return clearPlanes;
  }, [sketchPlacementMode]);

  // ── Rebuild scene objects ─────────────────────────────────────────────────

  useEffect(() => {
    if (!sceneRef.current) return;
    buildSceneObjects(items, sceneRef.current, objectsRef, originalMaterialsRef);

    if (renderMode === "smooth" && rendererRef.current) {
      if (!envTextureRef.current) {
        const pmremGen = new THREE.PMREMGenerator(rendererRef.current);
        pmremGen.compileEquirectangularShader();
        const roomEnv = new RoomEnvironment();
        envTextureRef.current = pmremGen.fromScene(roomEnv).texture;
        pmremGen.dispose();
        roomEnv.dispose();
      }
      sceneRef.current.environment = envTextureRef.current;
      Object.values(objectsRef.current).forEach((mesh) => {
        const itemData = itemsRef.current.find((i) => i.id === mesh.userData.itemId);
        if (itemData?.type === "sketch") return;
        const orig = originalMaterialsRef.current[mesh.userData.itemId];
        const col = orig ? orig.color.clone() : new THREE.Color(0xe0e0e0);
        if (mesh.material) mesh.material.dispose();
        mesh.material = new THREE.MeshPhysicalMaterial({
          color: col, metalness: 0.15, roughness: 0.3,
          clearcoat: 1.0, clearcoatRoughness: 0.1, envMapIntensity: 1.2,
        });
        mesh.children.forEach((child) => { child.visible = false; });
      });
    }
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Transform handles + bounding box ─────────────────────────────────────

  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;

    handlesRef.current.forEach(({ mesh }) => { scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); });
    handlesRef.current = [];
    handleDragRef.current = null;

    if (boundingBoxRef.current) {
      const { boxMesh, labelX, labelY, labelZ } = boundingBoxRef.current;
      scene.remove(boxMesh); scene.remove(labelX.sprite); scene.remove(labelY.sprite); scene.remove(labelZ.sprite);
      boxMesh.geometry.dispose(); boxMesh.material.dispose();
      labelX.mat.map.dispose(); labelX.mat.dispose();
      labelY.mat.map.dispose(); labelY.mat.dispose();
      labelZ.mat.map.dispose(); labelZ.mat.dispose();
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
        hm.geometry.dispose(); hm.material.dispose();
      });
      handlesRef.current = [];
      if (boundingBoxRef.current) {
        const { boxMesh, labelX: lx, labelY: ly, labelZ: lz } = boundingBoxRef.current;
        if (sceneRef.current) {
          sceneRef.current.remove(boxMesh);
          sceneRef.current.remove(lx.sprite); sceneRef.current.remove(ly.sprite); sceneRef.current.remove(lz.sprite);
        }
        boxMesh.geometry.dispose(); boxMesh.material.dispose();
        lx.mat.map.dispose(); lx.mat.dispose();
        ly.mat.map.dispose(); ly.mat.dispose();
        lz.mat.map.dispose(); lz.mat.dispose();
        boundingBoxRef.current = null;
      }
    };
  }, [selectedId, items]);

  // ── Sketch mode (top-down view + grid) ───────────────────────────────────

  useEffect(() => {
    if (!sceneRef.current) return;
    const scene = sceneRef.current;
    const selectedItem = items.find((i) => i.id === selectedId);
    const isSketch = selectedItem?.type === "sketch";

    const clearSketchGrid = () => {
      if (sketchGridGroupRef.current) {
        scene.remove(sketchGridGroupRef.current);
        sketchGridGroupRef.current.traverse((obj) => {
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) { if (obj.material.map) obj.material.map.dispose(); obj.material.dispose(); }
        });
        sketchGridGroupRef.current = null;
      }
    };

    if (!isSketch) {
      if (sketchModeRef.current) {
        sketchModeRef.current = false;
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
        if (axisGroupRef.current) axisGroupRef.current.visible = useStore.getState().axisVisible;
        if (planeRef.current) planeRef.current.visible = true;
        Object.values(objectsRef.current).forEach((m) => {
          m.visible = true;
          m.material.transparent = false;
          m.material.opacity = 1.0;
          m.material.needsUpdate = true;
        });
        clearSketchGrid();
        const saved = savedCameraStateRef.current;
        if (saved && cameraRef.current && cameraControlsRef.current) {
          const camera = cameraRef.current;
          const controls = cameraControlsRef.current;
          cameraAnimRef.current = {
            startPos: camera.position.clone(),
            endPos: new THREE.Vector3(saved.positionX, saved.positionY, saved.positionZ),
            startTarget: targetRef.current.clone(),
            endTarget: new THREE.Vector3(saved.targetX, saved.targetY, saved.targetZ),
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
          positionX: camera.position.x, positionY: camera.position.y, positionZ: camera.position.z,
          targetX: targetRef.current.x, targetY: targetRef.current.y, targetZ: targetRef.current.z,
          rotationX: controls.targetRotationX, rotationY: controls.targetRotationY,
        };
      }
      sketchModeRef.current = true;
      if (axisGroupRef.current) axisGroupRef.current.visible = false;
    }

    const worldNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion).normalize();
    const meshCenter = mesh.position.clone();
    const camPos = meshCenter.clone().addScaledVector(worldNormal, 15);

    if (cameraRef.current && cameraControlsRef.current) {
      const camera = cameraRef.current;
      const controls = cameraControlsRef.current;
      cameraAnimRef.current = {
        startPos: camera.position.clone(), endPos: camPos.clone(),
        startTarget: targetRef.current.clone(), endTarget: meshCenter.clone(),
        startUp: camera.up.clone(), endUp: worldUp.clone(),
        startTime: Date.now(), duration: 500,
        onComplete: () => {
          cameraRef.current.up.copy(worldUp);
          const dp = camPos.clone().sub(meshCenter);
          const dist = dp.length();
          controls.targetRotationX = dist > 0 ? Math.asin(Math.max(-1, Math.min(1, dp.y / dist))) : 0;
          controls.targetRotationY = Math.atan2(dp.x, dp.z);
          setRotationState(cameraRef.current.quaternion.clone());
        },
      };
    }

    if (planeRef.current) planeRef.current.visible = false;
    Object.entries(objectsRef.current).forEach(([idStr, m]) => {
      if (parseInt(idStr) === selectedId) {
        m.visible = true; m.material.transparent = true; m.material.opacity = 0.12; m.material.needsUpdate = true;
      } else {
        m.visible = false;
      }
    });

    clearSketchGrid();
    const gridGroup = new THREE.Group();
    const GRID_HALF = 5;
    const lineMat = new THREE.LineBasicMaterial({ color: 0x445566, transparent: true, opacity: 0.55 });
    for (let i = -GRID_HALF; i <= GRID_HALF; i++) {
      if (i === 0) continue;
      gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(i, -GRID_HALF, 0), new THREE.Vector3(i, GRID_HALF, 0)]), lineMat.clone()));
      gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-GRID_HALF, i, 0), new THREE.Vector3(GRID_HALF, i, 0)]), lineMat.clone()));
    }
    gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-GRID_HALF, 0, 0), new THREE.Vector3(GRID_HALF, 0, 0)]), new THREE.LineBasicMaterial({ color: 0xff4444 })));
    gridGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -GRID_HALF, 0), new THREE.Vector3(0, GRID_HALF, 0)]), new THREE.LineBasicMaterial({ color: 0x4488ff })));
    for (let i = -GRID_HALF; i <= GRID_HALF; i++) {
      if (i === 0) continue;
      const xLbl = makeMeasureLabel(`${i * MM_PER_UNIT}`, "#ff6666"); xLbl.position.set(i, -0.42, 0.01); gridGroup.add(xLbl);
      const yLbl = makeMeasureLabel(`${i * MM_PER_UNIT}`, "#6699ff"); yLbl.position.set(-0.58, i, 0.01); gridGroup.add(yLbl);
    }
    gridGroup.position.copy(mesh.position);
    gridGroup.quaternion.copy(mesh.quaternion);
    scene.add(gridGroup);
    sketchGridGroupRef.current = gridGroup;
  }, [selectedId, items]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const group = buildSketchShapesGroup(selectedId, items, objectsRef);
    if (group) { scene.add(group); sketchShapesGroupRef.current = group; }
  }, [selectedId, items]);

  // ── Emissive highlight ────────────────────────────────────────────────────

  useEffect(() => {
    updateEmissive(objectsRef, selectedId, selectedIds, hoveredId);
  }, [hoveredId, selectedId, selectedIds]);

  // ── Render mode ───────────────────────────────────────────────────────────

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
    });
  }, [renderMode]);

  return (
    <div className="viewport-container">
      <div
        ref={containerRef}
        className="viewport"
        style={(sketchPlacementMode || activeSketchTool) ? { cursor: "crosshair" } : undefined}
      />
      {sketchPlacementMode && (
        <div className="sketch-placement-hint">
          Click an axis plane or object face to place the sketch · Esc to cancel
        </div>
      )}
      {activeSketchTool && sketchDrawPhase !== "second" && (
        <div className="sketch-placement-hint">Click to set the start point</div>
      )}
      <div ref={dimHintRef} className="sketch-dim-overlay" style={{ display: "none" }} />
      {isInSketchMode && (
        <button
          className="close-sketch-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); selectItem(null); }}
        >
          ✕ Close Sketch
        </button>
      )}
      {widgetVisible && (
        <RotationWidget rotationState={rotationState} onOrientationChange={handleOrientationChange} />
      )}
    </div>
  );
};

export default Viewport;
