import React, { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import RotationWidget from "./RotationWidget";
import "../styles/Viewport.css";
import { useStore } from "../store";
import {
  createScene,
  createCamera,
  createRenderer,
  createLights,
  createGrid,
  createAxisGroup,
  createOrbitIndicator,
  setupResize,
} from "../three/sceneSetup.js";
import { updateEmissive } from "../three/objectMaterials.js";
import {
  buildSceneObjects,
  buildTransformHandles,
  buildSketchShapesGroup,
  buildAllSketchShapesGroup,
  buildExtrudeSelectGroup,
  applyRenderMode,
  makeMeasureLabel,
  MM_PER_UNIT,
  placeDimLabels,
  getShapePoint,
  moveShapePoint,
} from "../three/sceneObjects.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  loadCameraState,
  saveCameraState,
  attachCameraControls,
} from "../three/cameraControls.js";
import {
  disposeHighlightGroup,
  reconcileSelectionHighlight,
} from "../three/selectionHighlights.js";

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

    const camera = createCamera(projectionMode, aspect, savedState, targetRef);
    cameraRef.current = camera;
    scene.add(camera);

    const controls = cameraControlsRef.current;
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

    createLights(scene, camera);
    const { gridPlane, gridMaterial } = createGrid(scene);
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

  useEffect(() => {
    if (axisGroupRef.current)
      axisGroupRef.current.visible = axisVisible && !sketchModeRef.current;
  }, [axisVisible]);

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
    useStore.getState().regenerateForResolution(printPrecision);
  }, [items, curveResolution]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [items, curveResolution]); // eslint-disable-line react-hooks/exhaustive-deps

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
      if (mesh) mesh.visible = false;

      // Project all non-sketch scene objects onto the sketch plane as faint reference lines
      scene.updateMatrixWorld();
      const planeNormal = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(mesh.quaternion)
        .normalize();
      const planeOrigin = mesh.position.clone();
      const projectVertex = (v) =>
        v
          .clone()
          .addScaledVector(
            planeNormal,
            -planeNormal.dot(v.clone().sub(planeOrigin)),
          );
      const ghostMat = new THREE.LineBasicMaterial({
        color: 0x7799bb,
        transparent: true,
        opacity: 0.18,
        depthTest: false,
      });
      const ghostGroup = new THREE.Group();
      items.forEach((item) => {
        if (item.type === "sketch" || item.visible === false) return;
        const m = objectsRef.current[item.id];
        if (!m) return;
        const isPrim = ["sphere", "cylinder", "torus"].includes(item.type);
        let srcGeo;
        if (item.type === "sphere")
          srcGeo = new THREE.SphereGeometry(1.5, 12, 8);
        else if (item.type === "cylinder")
          srcGeo = new THREE.CylinderGeometry(1, 1, 2, 12);
        else if (item.type === "torus")
          srcGeo = new THREE.TorusGeometry(1.0, 0.4, 6, 12);
        else srcGeo = m.geometry;
        const edgesGeo = new THREE.EdgesGeometry(srcGeo);
        if (isPrim) srcGeo.dispose();
        const posAttr = edgesGeo.getAttribute("position");
        const pts = [];
        for (let i = 0; i < posAttr.count; i++) {
          const v = new THREE.Vector3(
            posAttr.getX(i),
            posAttr.getY(i),
            posAttr.getZ(i),
          ).applyMatrix4(m.matrixWorld);
          pts.push(projectVertex(v).addScaledVector(planeNormal, 0.003));
        }
        edgesGeo.dispose();
        if (pts.length < 2) return;
        const ghost = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(pts),
          ghostMat,
        );
        ghost.frustumCulled = false;
        ghost.renderOrder = 998;
        ghostGroup.add(ghost);
      });
      if (ghostGroup.children.length > 0) {
        scene.add(ghostGroup);
        sketchGhostGroupRef.current = ghostGroup;
      } else {
        ghostMat.dispose();
      }
    }

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

    if (planeRef.current) planeRef.current.visible = false;
    Object.values(objectsRef.current).forEach((m) => {
      m.visible = false;
    });

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
      {sketchPlacementMode && (
        <div className="sketch-placement-hint">
          Click an axis plane or object face to place the sketch · Esc to cancel
        </div>
      )}
      {extrudeSelectMode === "profile" && (
        <div className="sketch-placement-hint">
          Click an enclosed sketch region or flat object face · Esc to cancel
        </div>
      )}
      {extrudeSelectMode === "depth" && (
        <div className="sketch-placement-hint">
          Move mouse to set depth, or type below · Click to confirm · Esc to cancel
        </div>
      )}
      {extrudeSelectMode === "depth" && extrudeDepthInput && (
        <div className="sketch-distance-input-overlay">
          <span>Depth (mm):</span>
          <input
            type="number"
            step="0.1"
            min="0.05"
            autoFocus
            value={(
              (extrudeDepthInput.currentDepth ??
                extrudeDepthInput.defaultDepth) * MM_PER_UNIT
            ).toFixed(2)}
            onChange={(e) => {
              const mm = parseFloat(e.target.value);
              if (!isNaN(mm) && mm > 0) {
                const depth = mm / MM_PER_UNIT;
                cameraControlsRef.current?.updateExtrudePreview?.(depth);
                useStore.getState().setExtrudeDepthInput({
                  ...extrudeDepthInput,
                  currentDepth: depth,
                });
              }
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                const mm = parseFloat(e.target.value);
                if (!isNaN(mm) && mm > 0) {
                  const depth = mm / MM_PER_UNIT;
                  cameraControlsRef.current?.finalizeExtrudeWithDepth?.(depth);
                }
              } else if (e.key === "Escape") {
                useStore.getState().setExtrudeSelectMode(null);
                useStore.getState().setExtrudeRetargetId(null);
                useStore.getState().setExtrudeDepthInput(null);
              }
            }}
          />
        </div>
      )}
      {activeSketchTool && sketchDrawPhase !== "second" && (
        <div className="sketch-placement-hint">
          Click to set the start point
        </div>
      )}
      {sketchMode && sketchConstraintMode === "coincident" && (
        <div className="sketch-placement-hint">
          {sketchConstraintFirstPoint
            ? "Select second point · Esc to cancel"
            : "Select a point · Esc to cancel"}
        </div>
      )}
      {sketchMode &&
        sketchConstraintMode === "distance" &&
        !sketchDistanceInput && (
          <div className="sketch-placement-hint">
            {sketchConstraintFirstPoint
              ? "Select second point · Esc to cancel"
              : "Click a line to set its length, or click two points · Esc to cancel"}
          </div>
        )}
      {sketchMode && sketchDistanceInput && (
        <div className="sketch-distance-input-overlay">
          <span>
            {sketchDistanceInput.constraintIdx != null
              ? "Edit distance (mm):"
              : "Distance (mm):"}
          </span>
          <input
            type="number"
            step="0.1"
            min="0.01"
            autoFocus
            defaultValue={(
              sketchDistanceInput.defaultDistance * MM_PER_UNIT
            ).toFixed(2)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                const mm = parseFloat(e.target.value);
                if (!isNaN(mm) && mm > 0) {
                  const {
                    shapeAIdx,
                    pointA,
                    shapeBIdx,
                    pointB,
                    constraintIdx,
                  } = sketchDistanceInput;
                  const d = mm / MM_PER_UNIT;
                  if (constraintIdx != null) {
                    useStore
                      .getState()
                      .updateSketchConstraintDistance(
                        selectedId,
                        constraintIdx,
                        d,
                      );
                  } else {
                    useStore.getState().addSketchConstraints(selectedId, [
                      {
                        type: "distance",
                        shapeAIdx,
                        pointA,
                        shapeBIdx,
                        pointB,
                        distance: d,
                      },
                    ]);
                  }
                  // Enforce the new/changed distance immediately.
                  // Key: use B (the shape being moved) as the primary, not A.
                  // Using A as primary causes the coincident BFS to mark B as "updated"
                  // before the distance enforcement pass runs, which makes it skip.
                  itemsRef.current = useStore.getState().items;
                  if (propagateConstraintsRef.current) {
                    const freshItem = itemsRef.current.find(
                      (i) => i.id === selectedId,
                    );
                    if (freshItem) {
                      if (shapeAIdx === shapeBIdx) {
                        // Same shape: line-length — keep pointA end fixed, slide pointB end.
                        const shape = freshItem.shapes[shapeAIdx];
                        if (shape) {
                          const pA = getShapePoint(shape, pointA);
                          const pB = getShapePoint(shape, pointB);
                          if (pA && pB) {
                            const ddx = pB.x - pA.x,
                              ddy = pB.y - pA.y;
                            const curLen = Math.hypot(ddx, ddy);
                            if (curLen > 1e-10) {
                              const newEnd = {
                                x: pA.x + (ddx / curLen) * d,
                                y: pA.y + (ddy / curLen) * d,
                              };
                              const newShape = moveShapePoint(
                                shape,
                                pointB,
                                newEnd,
                              );
                              if (newShape) {
                                const propagated =
                                  propagateConstraintsRef.current(
                                    selectedId,
                                    shapeAIdx,
                                    newShape,
                                    pointB,
                                  );
                                if (propagated.size > 1)
                                  useStore
                                    .getState()
                                    .updateSketchShapes(selectedId, propagated);
                                else
                                  useStore
                                    .getState()
                                    .updateSketchShape(
                                      selectedId,
                                      shapeAIdx,
                                      newShape,
                                    );
                              }
                            }
                          }
                        }
                      } else {
                        // Two shapes: keep A fixed, move B's constrained point to distance d from A.
                        const sA = freshItem.shapes[shapeAIdx];
                        const sB = freshItem.shapes[shapeBIdx];
                        if (sA && sB) {
                          const pA = getShapePoint(sA, pointA);
                          const pB = getShapePoint(sB, pointB);
                          if (pA && pB) {
                            const ddx = pB.x - pA.x,
                              ddy = pB.y - pA.y;
                            const curDist = Math.hypot(ddx, ddy);
                            if (curDist > 1e-10) {
                              const newPt = {
                                x: pA.x + (ddx / curDist) * d,
                                y: pA.y + (ddy / curDist) * d,
                              };
                              const newSB = moveShapePoint(sB, pointB, newPt);
                              if (newSB) {
                                const propagated =
                                  propagateConstraintsRef.current(
                                    selectedId,
                                    shapeBIdx,
                                    newSB,
                                    pointB,
                                  );
                                if (propagated.size > 1)
                                  useStore
                                    .getState()
                                    .updateSketchShapes(selectedId, propagated);
                                else
                                  useStore
                                    .getState()
                                    .updateSketchShape(
                                      selectedId,
                                      shapeBIdx,
                                      newSB,
                                    );
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
                useStore.getState().setSketchDistanceInput(null);
                useStore.getState().setSketchConstraintMode(null);
              } else if (e.key === "Escape") {
                useStore.getState().setSketchDistanceInput(null);
                useStore.getState().setSketchConstraintMode(null);
              }
            }}
          />
        </div>
      )}
      {sketchMode && sketchModifyMode && (
        <div className="sketch-placement-hint">
          {sketchModifyMode === "chamfer"
            ? "Click a corner between two lines to chamfer"
            : "Click a corner between two lines to bevel"}{" "}
          · Esc to cancel
        </div>
      )}
      <div
        ref={dimHintRef}
        className="sketch-dim-overlay"
        style={{ display: "none" }}
      />
      {isInSketchMode && (
        <button
          className="close-sketch-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            selectItem(null);
          }}
        >
          ✕ Close Sketch
        </button>
      )}
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
