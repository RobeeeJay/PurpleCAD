import React, { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import RotationWidget from "./RotationWidget";
import "../styles/Viewport.css";
import { useStore } from "../store";

const MM_PER_UNIT = 10; // 1 world unit = 10 mm

// World-space bounding box dimensions for each object type at the given uniform scale
const getObjectDimensions = (itemType, uniformScale) => {
  const s = uniformScale || 1;
  switch (itemType) {
    case "cube":
      return { w: 2 * s, h: 2 * s, d: 2 * s };
    case "sphere":
      return { w: 3 * s, h: 3 * s, d: 3 * s };
    case "sketch":
      return { w: 3 * s, h: 3 * s, d: 0.05 };
    default:
      return { w: 2 * s, h: 2 * s, d: 2 * s };
  }
};

const makeDimSprite = (text, cssColor) => {
  const W = 168,
    H = 52;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(12,12,12,0.85)";
  ctx.fillRect(3, 3, W - 6, H - 6);
  ctx.strokeStyle = cssColor;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.fillStyle = cssColor;
  ctx.font = "bold 26px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    depthTest: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.5, 0.46, 1);
  sprite.renderOrder = 1000;
  return { sprite, canvas, ctx, mat };
};

const redrawDimSprite = (dimObj, text, cssColor) => {
  const { canvas, ctx, mat } = dimObj;
  const W = canvas.width,
    H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(12,12,12,0.85)";
  ctx.fillRect(3, 3, W - 6, H - 6);
  ctx.strokeStyle = cssColor;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.fillStyle = cssColor;
  ctx.font = "bold 26px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2);
  mat.map.needsUpdate = true;
};

const placeDimLabels = (boundingBox, pos, dim) => {
  const { labelX, labelY, labelZ } = boundingBox;
  const GAP = 0.75;
  const hw = dim.w / 2,
    hh = dim.h / 2,
    hd = dim.d / 2;
  // X label: above the top-front edge, centered along X
  labelX.sprite.position.set(pos.x, pos.y + hh + GAP, pos.z - hd);
  // Y label: right of the right-front edge, centered along Y
  labelY.sprite.position.set(pos.x + hw + GAP, pos.y, pos.z - hd);
  // Z label: above-right corner, centered along Z
  labelZ.sprite.position.set(pos.x + hw + GAP, pos.y + hh + GAP, pos.z);
};

const makeMeasureLabel = (text, cssColor) => {
  const W = 120, H = 38;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = cssColor;
  ctx.font = "bold 22px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.8, 0.25, 1);
  sprite.renderOrder = 1001;
  return sprite;
};

// ── Sketch 2D shape helpers ──────────────────────────────────────────────────

const buildSketchShape = (tool, start, current) => {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const r = Math.sqrt(dx * dx + dy * dy);
  switch (tool) {
    case "rect":
      return { type: "rect", x1: start.x, y1: start.y, x2: current.x, y2: current.y };
    case "circle":
      return { type: "circle", cx: start.x, cy: start.y, r };
    case "ellipse":
      return { type: "ellipse", cx: start.x, cy: start.y, rx: Math.abs(dx), ry: Math.abs(dy) };
    case "line":
      return { type: "line", x1: start.x, y1: start.y, x2: current.x, y2: current.y };
    case "arc": {
      const startAngle = Math.atan2(dy, dx);
      return { type: "arc", cx: start.x, cy: start.y, r, startAngle, endAngle: startAngle + Math.PI / 2 };
    }
    default:
      return null;
  }
};

const getSketchShapePoints = (shape, sketchMesh) => {
  const toWorld = (lx, ly) => {
    const v = new THREE.Vector3(lx, ly, 0.003);
    v.applyQuaternion(sketchMesh.quaternion);
    v.add(sketchMesh.position);
    return v;
  };
  switch (shape.type) {
    case "rect": {
      const { x1, y1, x2, y2 } = shape;
      return [toWorld(x1, y1), toWorld(x2, y1), toWorld(x2, y2), toWorld(x1, y2), toWorld(x1, y1)];
    }
    case "circle": {
      const { cx, cy, r } = shape;
      return Array.from({ length: 65 }, (_, i) => {
        const a = (i / 64) * Math.PI * 2;
        return toWorld(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      });
    }
    case "ellipse": {
      const { cx, cy, rx, ry } = shape;
      return Array.from({ length: 65 }, (_, i) => {
        const a = (i / 64) * Math.PI * 2;
        return toWorld(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
      });
    }
    case "line":
      return [toWorld(shape.x1, shape.y1), toWorld(shape.x2, shape.y2)];
    case "arc": {
      const { cx, cy, r, startAngle, endAngle } = shape;
      return Array.from({ length: 33 }, (_, i) => {
        const a = startAngle + (i / 32) * (endAngle - startAngle);
        return toWorld(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      });
    }
    default:
      return [];
  }
};

const sketchDimText = (tool, start, current) => {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const L = Math.sqrt(dx * dx + dy * dy) * MM_PER_UNIT;
  const W = Math.abs(dx) * MM_PER_UNIT;
  const H = Math.abs(dy) * MM_PER_UNIT;
  switch (tool) {
    case "line":   return `${L.toFixed(1)} mm`;
    case "arc":    return `r ${L.toFixed(1)} mm`;
    case "circle": return `⌀ ${(L * 2).toFixed(1)} mm`;
    default:       return `W ${W.toFixed(1)}  H ${H.toFixed(1)} mm`;
  }
};

// Handle configs: type, axis color, world-space direction
const HANDLE_CONFIGS = [
  { type: "axisX", color: 0xff4444, dir: new THREE.Vector3(1, 0, 0) },
  { type: "axisY", color: 0x4488ff, dir: new THREE.Vector3(0, 1, 0) },
  { type: "axisZ", color: 0x44ff44, dir: new THREE.Vector3(0, 0, 1) },
  {
    type: "scale",
    color: 0xffffff,
    dir: new THREE.Vector3(1, 1, 1).normalize(),
  },
];

// Half-extent of each object type at scale=1, used to position handles at the surface
const getObjectExtent = (itemType, uniformScale) => {
  const s = uniformScale || 1;
  switch (itemType) {
    case "cube":
      return 1.0 * s;
    case "sphere":
      return 1.5 * s;
    case "sketch":
      return 1.5 * s;
    default:
      return 1.0 * s;
  }
};

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
  const handlesRef = useRef([]); // [{ mesh, type, dir }]
  const handleDragRef = useRef(null); // active drag state
  const transformDebounceRef = useRef(null);
  const boundingBoxRef = useRef(null); // { boxMesh, labelX, labelY, labelZ }
  const axisGroupRef = useRef(null);
  const composerRef = useRef(null);
  const envTextureRef = useRef(null);
  const faceHighlightRef = useRef(null);
  const sketchModeRef = useRef(false);
  const savedCameraStateRef = useRef(null);
  const sketchGridGroupRef = useRef(null);
  const cameraAnimRef = useRef(null);
  const sketchPlacementModeRef = useRef(false);
  const sketchPlacementPlanesRef = useRef([]);
  const sketchDrawRef = useRef(null); // { tool, startLocal, previewObjects: [] }
  const sketchShapesGroupRef = useRef(null);
  const dimHintRef = useRef(null);

  const [rotationState, setRotationState] = React.useState(null);
  const [sketchDrawPhase, setSketchDrawPhase] = React.useState(null); // null | 'first' | 'second'

  // Live refs so event handlers (created once) always see current values
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

  // Keep live refs in sync every render
  selectedIdRef.current = selectedId;
  selectedIdsRef.current = selectedIds;
  itemsRef.current = items;
  sketchPlacementModeRef.current = sketchPlacementMode;
  activeSketchToolRef.current = activeSketchTool;

  // Handle orientation change from rotation widget — animates to new view
  const handleOrientationChange = useCallback((targetRotX, targetRotY) => {
    if (!cameraRef.current || !cameraControlsRef.current) return;
    const camera = cameraRef.current;
    const controls = cameraControlsRef.current;
    const distance = camera.position.distanceTo(targetRef.current);
    const endPos = new THREE.Vector3(
      targetRef.current.x + Math.sin(targetRotY) * Math.cos(targetRotX) * distance,
      targetRef.current.y + Math.sin(targetRotX) * distance,
      targetRef.current.z + Math.cos(targetRotY) * Math.cos(targetRotX) * distance
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
        saveCameraState();
      },
    };
  }, []);

  // Load camera position from localStorage
  const loadCameraState = () => {
    try {
      const saved = localStorage.getItem("cad-camera-state");
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.warn("Failed to load camera state from localStorage:", e);
    }
    return {
      positionX: 10,
      positionY: 10,
      positionZ: 10,
      targetX: 0,
      targetY: 0,
      targetZ: 0,
    };
  };

  const saveCameraState = () => {
    if (!cameraRef.current || !cameraControlsRef.current) return;
    try {
      const state = {
        positionX: cameraRef.current.position.x,
        positionY: cameraRef.current.position.y,
        positionZ: cameraRef.current.position.z,
        targetX: targetRef.current.x,
        targetY: targetRef.current.y,
        targetZ: targetRef.current.z,
        rotationX: cameraControlsRef.current.targetRotationX,
        rotationY: cameraControlsRef.current.targetRotationY,
      };
      localStorage.setItem("cad-camera-state", JSON.stringify(state));
    } catch (e) {
      console.warn("Failed to save camera state to localStorage:", e);
    }
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const savedState = loadCameraState();

    const scene = new THREE.Scene();
    const bgColor = theme === "light" ? 0xe8e8e8 : 0x1a1a1a;
    scene.background = new THREE.Color(bgColor);
    sceneRef.current = scene;

    const aspect =
      containerRef.current.clientWidth / containerRef.current.clientHeight;
    const frustumSize = 20;
    const savedTarget = new THREE.Vector3(
      savedState.targetX,
      savedState.targetY,
      savedState.targetZ,
    );
    targetRef.current.copy(savedTarget);

    let camera;
    if (projectionMode === "isometric") {
      camera = new THREE.OrthographicCamera(
        (-frustumSize * aspect) / 2,
        (frustumSize * aspect) / 2,
        frustumSize / 2,
        -frustumSize / 2,
        0.1,
        1000,
      );
    } else {
      camera = new THREE.PerspectiveCamera(35, aspect, 0.1, 1000);
    }
    camera.position.set(
      savedState.positionX,
      savedState.positionY,
      savedState.positionZ,
    );
    camera.lookAt(targetRef.current);
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

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(
      containerRef.current.clientWidth,
      containerRef.current.clientHeight,
    );
    renderer.setPixelRatio(window.devicePixelRatio);
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(10, 15, 10);
    directionalLight.castShadow = true;
    camera.add(directionalLight);
    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight2.position.set(-10, 10, -10);
    camera.add(directionalLight2);
    const pointLight = new THREE.PointLight(0xffffff, 0.3, 50);
    pointLight.position.set(0, 10, 0);
    camera.add(pointLight);

    const gridRGB = [0.45, 0.45, 0.45];
    const gridMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uCameraPos: { value: new THREE.Vector3() },
        uGridColor: { value: new THREE.Vector3(...gridRGB) },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPos;
        uniform vec3 uCameraPos;
        uniform vec3 uGridColor;
        void main() {
          vec2 coord = vWorldPos.xz;
          vec2 g1 = abs(fract(coord - 0.5) - 0.5) / fwidth(coord);
          float fine = 1.0 - min(min(g1.x, g1.y), 1.0);
          vec2 g5 = abs(fract(coord / 5.0 - 0.5) - 0.5) / fwidth(coord / 5.0);
          float coarse = 1.0 - min(min(g5.x, g5.y), 1.0);
          float dist = length(vWorldPos.xz - uCameraPos.xz);
          float fadeFine   = 1.0 - smoothstep(8.0,  45.0, dist);
          float fadeCoarse = 1.0 - smoothstep(20.0, 80.0, dist);
          float alpha = max(coarse * fadeCoarse, fine * fadeFine * 0.6);
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(uGridColor, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const gridPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(2000, 2000),
      gridMaterial,
    );
    gridPlane.rotation.x = -Math.PI / 2;
    scene.add(gridPlane);
    planeRef.current = gridPlane;

    const AXIS_R = 0.028;
    const AXIS_LEN = 2.5;
    const CONE_R = 0.065;
    const CONE_H = 0.35;
    const LABEL_DIST = AXIS_LEN + CONE_H + 0.3;

    const axisGroup = new THREE.Group();

    const addAxisArrow = (color, shaftEuler, shaftPos, conePos) => {
      const shaftGeo = new THREE.CylinderGeometry(AXIS_R, AXIS_R, AXIS_LEN, 8);
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
      const shaft = new THREE.Mesh(shaftGeo, mat);
      shaft.rotation.copy(shaftEuler);
      shaft.position.copy(shaftPos);
      shaft.renderOrder = 997;
      axisGroup.add(shaft);
      const coneGeo = new THREE.ConeGeometry(CONE_R, CONE_H, 8);
      const cone = new THREE.Mesh(coneGeo, mat.clone());
      cone.rotation.copy(shaftEuler);
      cone.position.copy(conePos);
      cone.renderOrder = 997;
      axisGroup.add(cone);
    };

    addAxisArrow(
      0xff4444,
      new THREE.Euler(0, 0, -Math.PI / 2),
      new THREE.Vector3(AXIS_LEN / 2, 0, 0),
      new THREE.Vector3(AXIS_LEN + CONE_H / 2, 0, 0),
    );
    addAxisArrow(
      0x4488ff,
      new THREE.Euler(0, 0, 0),
      new THREE.Vector3(0, AXIS_LEN / 2, 0),
      new THREE.Vector3(0, AXIS_LEN + CONE_H / 2, 0),
    );
    addAxisArrow(
      0x44ff44,
      new THREE.Euler(Math.PI / 2, 0, 0),
      new THREE.Vector3(0, 0, AXIS_LEN / 2),
      new THREE.Vector3(0, 0, AXIS_LEN + CONE_H / 2),
    );

    const makeAxisLabel = (text, color) => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = color;
      ctx.font = "bold 48px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, 32, 32);
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({
        map: texture,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(0.5, 0.5, 0.5);
      return sprite;
    };
    const xLabel = makeAxisLabel("X", "#ff4444");
    xLabel.position.set(LABEL_DIST, 0, 0);
    axisGroup.add(xLabel);
    const yLabel = makeAxisLabel("Y", "#4488ff");
    yLabel.position.set(0, LABEL_DIST, 0);
    axisGroup.add(yLabel);
    const zLabel = makeAxisLabel("Z", "#44ff44");
    zLabel.position.set(0, 0, LABEL_DIST);
    axisGroup.add(zLabel);

    axisGroup.visible = useStore.getState().axisVisible;
    scene.add(axisGroup);
    axisGroupRef.current = axisGroup;

    const handleResize = () => {
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      const currentCamera = cameraRef.current;
      if (!currentCamera) return;
      currentCamera.aspect = width / height;
      currentCamera.updateProjectionMatrix();
      renderer.setSize(width, height);
      if (composerRef.current) composerRef.current.setSize(width, height);
    };
    window.addEventListener("resize", handleResize);

    // ── Mouse handlers ────────────────────────────────────────────────────────

    // ── Orbit centre indicator ────────────────────────────────────────────────
    const orbitIndicatorGeo = new THREE.SphereGeometry(0.07, 16, 12);
    const orbitIndicatorMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    const orbitIndicator = new THREE.Mesh(orbitIndicatorGeo, orbitIndicatorMat);
    orbitIndicator.renderOrder = 999;
    orbitIndicator.visible = false;
    scene.add(orbitIndicator);

    // ── Sketch drawing helpers ────────────────────────────────────────────────

    const screenToSketchLocal = (screenX, screenY, sketchMesh) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
      const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
      const ray = new THREE.Raycaster();
      ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(sketchMesh.quaternion);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, sketchMesh.position);
      const worldPt = new THREE.Vector3();
      if (!ray.ray.intersectPlane(plane, worldPt)) return null;
      const localPt = worldPt.clone().sub(sketchMesh.position).applyQuaternion(sketchMesh.quaternion.clone().invert());
      return { x: localPt.x, y: localPt.y };
    };

    const clearSketchPreview = () => {
      const draw = sketchDrawRef.current;
      if (draw) {
        draw.previewObjects.forEach((obj) => {
          scene.remove(obj);
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
        });
        draw.previewObjects = [];
      }
    };

    const updateSketchPreview = (screenX, screenY) => {
      const draw = sketchDrawRef.current;
      if (!draw) return;
      const selItem = itemsRef.current.find((i) => i.id === selectedIdRef.current);
      const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
      if (!sketchMesh) return;

      const cur = screenToSketchLocal(screenX, screenY, sketchMesh);
      if (!cur) return;

      clearSketchPreview();

      const shape = buildSketchShape(draw.tool, draw.startLocal, cur);
      if (shape) {
        const pts = getSketchShapePoints(shape, sketchMesh);
        if (pts.length >= 2) {
          const geo = new THREE.BufferGeometry().setFromPoints(pts);
          const mat = new THREE.LineBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.75, depthTest: false });
          const line = new THREE.Line(geo, mat);
          line.renderOrder = 1002;
          scene.add(line);
          draw.previewObjects.push(line);
        }
      }

      // Update dim hint
      if (dimHintRef.current) {
        const rect = renderer.domElement.getBoundingClientRect();
        dimHintRef.current.textContent = sketchDimText(draw.tool, draw.startLocal, cur);
        dimHintRef.current.style.display = "block";
        dimHintRef.current.style.left = `${screenX - rect.left + 16}px`;
        dimHintRef.current.style.top = `${screenY - rect.top - 10}px`;
      }
    };

    const handleSketchClick = (screenX, screenY) => {
      const selItem = itemsRef.current.find((i) => i.id === selectedIdRef.current);
      const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
      if (!sketchMesh) return;

      const localPt = screenToSketchLocal(screenX, screenY, sketchMesh);
      if (!localPt) return;

      if (!sketchDrawRef.current) {
        // First click: record start, enter rubber-band phase
        sketchDrawRef.current = { tool: activeSketchToolRef.current, startLocal: localPt, previewObjects: [] };
        setSketchDrawPhase("second");
      } else {
        // Second click: finalise shape
        const shape = buildSketchShape(sketchDrawRef.current.tool, sketchDrawRef.current.startLocal, localPt);
        clearSketchPreview();
        sketchDrawRef.current = null;
        setSketchDrawPhase("first");
        if (dimHintRef.current) dimHintRef.current.style.display = "none";
        if (shape) useStore.getState().addSketchShape(selectedIdRef.current, shape);
      }
    };

    // Cast a ray through the viewport centre; return best orbit anchor point.
    const getOrbitAnchor = () => {
      const cam = cameraRef.current;
      const r = new THREE.Raycaster();
      r.setFromCamera({ x: 0, y: 0 }, cam);
      const objMeshes = Object.values(objectsRef.current);
      if (objMeshes.length > 0) {
        const hits = r.intersectObjects(objMeshes, false);
        if (hits.length > 0) return hits[0].point.clone();
      }
      const groundY = targetRef.current.y;
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY);
      const hit = new THREE.Vector3();
      if (r.ray.intersectPlane(groundPlane, hit)) return hit.clone();
      return targetRef.current.clone();
    };

    // Move the orbit target and resync the spherical angles so the camera doesn't jump.
    const setOrbitAnchor = (newTarget) => {
      targetRef.current.copy(newTarget);
      const dp = new THREE.Vector3().subVectors(cameraRef.current.position, newTarget);
      const dist = dp.length();
      controls.targetRotationX = dist > 0 ? Math.asin(Math.max(-1, Math.min(1, dp.y / dist))) : 0;
      controls.targetRotationY = Math.atan2(dp.x, dp.z);
      orbitIndicator.position.copy(newTarget);
      orbitIndicator.visible = true;
    };

    const onMouseDown = (e) => {
      if (e.button === 0) {
        // Intercept for sketch drawing
        if (sketchModeRef.current && activeSketchToolRef.current) {
          controls.mouseDownX = e.clientX;
          controls.mouseDownY = e.clientY;
          controls.mouseX = e.clientX;
          controls.mouseY = e.clientY;
          return;
        }

        const rect = renderer.domElement.getBoundingClientRect();
        const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera({ x: nx, y: ny }, cameraRef.current);

        // Check for handle hit first
        const handleMeshes = handlesRef.current.map((h) => h.mesh);
        if (handleMeshes.length > 0) {
          const hits = raycasterRef.current.intersectObjects(handleMeshes);
          if (hits.length > 0) {
            const hitHandle = handlesRef.current.find(
              (h) => h.mesh === hits[0].object,
            );
            if (hitHandle) {
              const selId = selectedIdRef.current;
              const mesh = objectsRef.current[selId];
              if (mesh) {
                const cam = cameraRef.current;
                const startPos = mesh.position.clone();
                const isRotHandle = hitHandle.type.startsWith("rot");
                let axisDirScreen = null;
                if (!isRotHandle && hitHandle.type !== "scale") {
                  const p0 = startPos.clone().project(cam);
                  const p1 = startPos
                    .clone()
                    .addScaledVector(hitHandle.dir, 1)
                    .project(cam);
                  const v = new THREE.Vector2(p1.x - p0.x, p1.y - p0.y);
                  if (v.length() > 0.0001) axisDirScreen = v.normalize();
                }
                const worldPerNDC = cam.isPerspectiveCamera
                  ? cam.position.distanceTo(startPos) *
                    Math.tan((cam.fov * Math.PI) / 360)
                  : (cam.top - cam.bottom) / 2;
                // Collect start transforms of all descendants for propagation
                const startDescendantPositions = {};
                const startDescendantQuaternions = {};
                const allItems = itemsRef.current;
                const collectDescendants = (pid) => {
                  allItems.forEach((di) => {
                    if (di.parentId === pid) {
                      const dMesh = objectsRef.current[di.id];
                      if (dMesh) {
                        startDescendantPositions[di.id] = dMesh.position.clone();
                        startDescendantQuaternions[di.id] = dMesh.quaternion.clone();
                      }
                      collectDescendants(di.id);
                    }
                  });
                };
                collectDescendants(selId);

                handleDragRef.current = {
                  handleType: hitHandle.type,
                  dir: isRotHandle ? null : hitHandle.dir.clone(),
                  axisDirScreen,
                  worldPerNDC,
                  startMouseX: e.clientX,
                  startMouseY: e.clientY,
                  startPos,
                  startScale: mesh.scale.x,
                  startRotation: isRotHandle
                    ? {
                        x: mesh.rotation.x,
                        y: mesh.rotation.y,
                        z: mesh.rotation.z,
                      }
                    : null,
                  startParentQuaternion: isRotHandle ? mesh.quaternion.clone() : null,
                  itemId: selId,
                  startDescendantPositions,
                  startDescendantQuaternions,
                };
                controls.mouseDownX = e.clientX;
                controls.mouseDownY = e.clientY;
                controls.mouseX = e.clientX;
                controls.mouseY = e.clientY;
                return; // intercept — no orbit
              }
            }
          }
        }

        controls.isPanning = true;
        controls.panDragMode = null;
        controls.panStartRayHit = null;
        controls.mouseDownX = e.clientX;
        controls.mouseDownY = e.clientY;
      } else if (e.button === 2) {
        if (!sketchModeRef.current) {
          controls.isRotating = true;
          setOrbitAnchor(getOrbitAnchor());
        }
      }
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
    };

    const onMouseMove = (e) => {
      const currentCamera = cameraRef.current;
      if (!currentCamera) return;

      // ── Sketch drawing preview ─────────────────────────────────────────────
      if (sketchModeRef.current && activeSketchToolRef.current) {
        if (sketchDrawRef.current) updateSketchPreview(e.clientX, e.clientY);
        controls.mouseX = e.clientX;
        controls.mouseY = e.clientY;
        return;
      }

      // ── Handle drag ────────────────────────────────────────────────────────
      if (handleDragRef.current) {
        const drag = handleDragRef.current;
        const mesh = objectsRef.current[drag.itemId];
        if (mesh) {
          const rect = renderer.domElement.getBoundingClientRect();
          const dxPx = e.clientX - drag.startMouseX;
          const dyPx = e.clientY - drag.startMouseY;

          if (drag.handleType.startsWith("rot")) {
            const delta = -dxPx * 0.01;
            if (drag.handleType === "rotX")
              mesh.rotation.x = drag.startRotation.x + delta;
            else if (drag.handleType === "rotY")
              mesh.rotation.y = drag.startRotation.y - delta;
            else if (drag.handleType === "rotZ")
              mesh.rotation.z = drag.startRotation.z + delta;
            const bb = boundingBoxRef.current;
            if (bb) bb.boxMesh.rotation.copy(mesh.rotation);

            // Propagate rotation to descendants: orbit around parent center
            if (drag.startParentQuaternion && drag.startDescendantPositions) {
              const deltaQuat = mesh.quaternion.clone().multiply(drag.startParentQuaternion.clone().invert());
              Object.entries(drag.startDescendantPositions).forEach(([idStr, startDPos]) => {
                const dMesh = objectsRef.current[parseInt(idStr, 10)];
                if (!dMesh) return;
                const relPos = startDPos.clone().sub(mesh.position);
                relPos.applyQuaternion(deltaQuat);
                dMesh.position.copy(mesh.position).add(relPos);
                const startDQuat = drag.startDescendantQuaternions?.[idStr];
                if (startDQuat) dMesh.quaternion.copy(deltaQuat.clone().multiply(startDQuat));
              });
            }
          } else if (drag.handleType === "scale") {
            // Drag up = scale up; logarithmic feel; 200 px = ×2
            const newScale = Math.max(
              0.05,
              drag.startScale * Math.pow(2, -dyPx / 200),
            );
            mesh.scale.setScalar(newScale);
          } else {
            const dxNDC = (dxPx / rect.width) * 2;
            const dyNDC = (-dyPx / rect.height) * 2;
            const projected = drag.axisDirScreen
              ? dxNDC * drag.axisDirScreen.x + dyNDC * drag.axisDirScreen.y
              : 0;
            mesh.position
              .copy(drag.startPos)
              .addScaledVector(drag.dir, projected * drag.worldPerNDC);

            // Propagate position delta to descendants
            if (drag.startDescendantPositions) {
              const delta = new THREE.Vector3().subVectors(mesh.position, drag.startPos);
              Object.entries(drag.startDescendantPositions).forEach(([idStr, startDPos]) => {
                const dMesh = objectsRef.current[parseInt(idStr, 10)];
                if (dMesh) dMesh.position.copy(startDPos).add(delta);
              });
            }
          }

          // Sync handle positions to follow the mesh
          const item = itemsRef.current.find((i) => i.id === drag.itemId);
          const ext = getObjectExtent(item ? item.type : "cube", mesh.scale.x);
          handlesRef.current.forEach(({ mesh: hm, dir }) => {
            if (dir) {
              hm.position.copy(mesh.position).addScaledVector(dir, ext + 0.5);
            } else {
              hm.position.copy(mesh.position);
            }
          });

          // Update bounding box and dimension labels
          const bb = boundingBoxRef.current;
          if (bb) {
            const itype = item ? item.type : "cube";
            const dim = getObjectDimensions(itype, mesh.scale.x);
            bb.boxMesh.scale.set(dim.w, dim.h, dim.d);
            bb.boxMesh.position.copy(mesh.position);
            const mmX = Math.round(dim.w * MM_PER_UNIT);
            const mmY = Math.round(dim.h * MM_PER_UNIT);
            const mmZ = Math.round(dim.d * MM_PER_UNIT);
            redrawDimSprite(bb.labelX, mmX + "mm", "#ff4444");
            redrawDimSprite(bb.labelY, mmY + "mm", "#4488ff");
            redrawDimSprite(bb.labelZ, mmZ + "mm", "#44ff44");
            placeDimLabels(bb, mesh.position, dim);
          }
        }
        controls.mouseX = e.clientX;
        controls.mouseY = e.clientY;
        return;
      }

      // ── Orbit / pan / hover ────────────────────────────────────────────────
      const deltaX = e.clientX - controls.mouseX;
      const deltaY = e.clientY - controls.mouseY;

      if (controls.isRotating) {
        const rotationSpeed = 0.005;
        controls.targetRotationY -= deltaX * rotationSpeed;
        controls.targetRotationX += deltaY * rotationSpeed;
        controls.targetRotationX = Math.max(
          -Math.PI / 2,
          Math.min(Math.PI / 2, controls.targetRotationX),
        );
        const distance = currentCamera.position.distanceTo(targetRef.current);
        currentCamera.position.x =
          targetRef.current.x +
          Math.sin(controls.targetRotationY) *
            Math.cos(controls.targetRotationX) *
            distance;
        currentCamera.position.y =
          targetRef.current.y + Math.sin(controls.targetRotationX) * distance;
        currentCamera.position.z =
          targetRef.current.z +
          Math.cos(controls.targetRotationY) *
            Math.cos(controls.targetRotationX) *
            distance;
        currentCamera.lookAt(targetRef.current);
        setRotationState(currentCamera.quaternion.clone());
      } else if (controls.isPanning) {
        if (sketchModeRef.current) {
          // Sketch mode: pan in camera's local right/up plane
          const panSpeed = 0.05;
          const right = new THREE.Vector3();
          currentCamera.getWorldDirection(right);
          const upVector = currentCamera.up.clone();
          right.cross(upVector).normalize();
          const panOffset = right
            .multiplyScalar(-deltaX * panSpeed)
            .add(upVector.clone().multiplyScalar(deltaY * panSpeed));
          currentCamera.position.add(panOffset);
          targetRef.current.add(panOffset);
          currentCamera.lookAt(targetRef.current);
        } else {
          // Lock pan mode on first movement threshold
          if (!controls.panDragMode) {
            const totalDx = e.clientX - controls.mouseDownX;
            const totalDy = e.clientY - controls.mouseDownY;
            if (Math.hypot(totalDx, totalDy) > 4) {
              const isVertical = Math.abs(totalDy) > Math.abs(totalDx) * 1.5;
              controls.panDragMode = isVertical ? "y" : "xz";
              controls.panStartCamPos = currentCamera.position.clone();
              controls.panStartTarget = targetRef.current.clone();

              if (controls.panDragMode === "xz") {
                // Sample two extra points to get pixel→world scale at drag start.
                // We use the UNMOVED camera here so there is no feedback loop later.
                const rect = renderer.domElement.getBoundingClientRect();
                const groundY = targetRef.current.y;
                const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY);

                const hitAt = (sx, sy) => {
                  const nx = ((sx - rect.left) / rect.width) * 2 - 1;
                  const ny = -((sy - rect.top) / rect.height) * 2 + 1;
                  const r = new THREE.Raycaster();
                  r.setFromCamera({ x: nx, y: ny }, currentCamera);
                  const h = new THREE.Vector3();
                  return r.ray.intersectPlane(groundPlane, h) ? h.clone() : null;
                };

                const h0 = hitAt(controls.mouseDownX, controls.mouseDownY);
                const h1 = hitAt(controls.mouseDownX + 100, controls.mouseDownY);
                const h2 = hitAt(controls.mouseDownX, controls.mouseDownY + 100);

                if (h0 && h1 && h2) {
                  // World-space XZ offset per screen pixel in each direction
                  controls.panDxWorld = new THREE.Vector3().subVectors(h1, h0).divideScalar(100);
                  controls.panDyWorld = new THREE.Vector3().subVectors(h2, h0).divideScalar(100);
                } else {
                  controls.panDragMode = "y"; // ray misses ground — fall back
                }
              }
            }
          }

          if (controls.panDragMode === "xz" && controls.panDxWorld) {
            // Linear formula using pre-baked scale — no per-frame raycasting, no feedback loop
            const totalDx = e.clientX - controls.mouseDownX;
            const totalDy = e.clientY - controls.mouseDownY;
            const worldOffset = new THREE.Vector3()
              .addScaledVector(controls.panDxWorld, totalDx)
              .addScaledVector(controls.panDyWorld, totalDy);
            currentCamera.position.x = controls.panStartCamPos.x - worldOffset.x;
            currentCamera.position.z = controls.panStartCamPos.z - worldOffset.z;
            targetRef.current.x = controls.panStartTarget.x - worldOffset.x;
            targetRef.current.z = controls.panStartTarget.z - worldOffset.z;
            currentCamera.lookAt(targetRef.current);
          } else if (controls.panDragMode === "y") {
            const panSpeed = 0.05;
            currentCamera.position.y += deltaY * panSpeed;
            targetRef.current.y += deltaY * panSpeed;
            currentCamera.lookAt(targetRef.current);
          }
        }
      } else {
        const rect = renderer.domElement.getBoundingClientRect();
        mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(mouseRef.current, currentCamera);
        const meshArray = Object.values(objectsRef.current).filter((m) => {
          const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
          return it?.type !== "sketch";
        });
        const intersects = raycasterRef.current.intersectObjects(meshArray, false);

        const clearFaceHighlight = () => {
          if (faceHighlightRef.current) {
            scene.remove(faceHighlightRef.current);
            faceHighlightRef.current.geometry.dispose();
            faceHighlightRef.current.material.dispose();
            faceHighlightRef.current = null;
          }
        };

        // Build a coplanar face overlay on top of `hit` using `color`
        const applyFaceHighlight = (hit, color) => {
          const hitMesh = hit.object;
          const hitNormal = hit.face.normal;
          const geo = hitMesh.geometry;
          const posAttr = geo.getAttribute("position");
          const indexAttr = geo.index;
          const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
          const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3();
          const triNormal = new THREE.Vector3();
          const matchVerts = [];
          for (let i = 0; i < triCount; i++) {
            let a, b, c;
            if (indexAttr) {
              a = indexAttr.getX(i * 3); b = indexAttr.getX(i * 3 + 1); c = indexAttr.getX(i * 3 + 2);
            } else { a = i * 3; b = i * 3 + 1; c = i * 3 + 2; }
            vA.set(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a));
            vB.set(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b));
            vC.set(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c));
            triNormal.crossVectors(
              new THREE.Vector3().subVectors(vB, vA),
              new THREE.Vector3().subVectors(vC, vA),
            ).normalize();
            if (Math.abs(triNormal.dot(hitNormal)) > 0.999) {
              matchVerts.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
            }
          }
          clearFaceHighlight();
          if (matchVerts.length > 0) {
            const hlGeo = new THREE.BufferGeometry();
            hlGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(matchVerts), 3));
            const hlMat = new THREE.MeshBasicMaterial({
              color,
              transparent: true,
              opacity: 0.5,
              depthTest: true,
              side: THREE.DoubleSide,
              polygonOffset: true,
              polygonOffsetFactor: -1,
              polygonOffsetUnits: -1,
            });
            const hlMesh = new THREE.Mesh(hlGeo, hlMat);
            hlMesh.position.copy(hitMesh.position);
            hlMesh.rotation.copy(hitMesh.rotation);
            hlMesh.scale.copy(hitMesh.scale);
            hlMesh.renderOrder = 996;
            scene.add(hlMesh);
            faceHighlightRef.current = hlMesh;
          }
        };

        if (sketchPlacementModeRef.current) {
          setHoveredId(null);
          // Reset all axis plane opacities
          sketchPlacementPlanesRef.current.forEach(({ mesh }) => { mesh.material.opacity = 0.18; });

          if (intersects.length > 0) {
            // Highlight the hovered face in orange to indicate "place here"
            applyFaceHighlight(intersects[0], 0xff8833);
          } else {
            clearFaceHighlight();
            // Highlight the hovered axis plane
            const planeMeshes = sketchPlacementPlanesRef.current.map((p) => p.mesh);
            const planeHits = raycasterRef.current.intersectObjects(planeMeshes, false);
            if (planeHits.length > 0) planeHits[0].object.material.opacity = 0.45;
          }
        } else {
          const isMac = navigator.platform.toUpperCase().includes("MAC");
          const faceMode = isMac ? e.metaKey : e.ctrlKey;

          if (faceMode) {
            setHoveredId(null);
            if (intersects.length > 0) {
              applyFaceHighlight(intersects[0], 0x88ccff);
            } else {
              clearFaceHighlight();
            }
          } else {
            clearFaceHighlight();
            if (intersects.length > 0) {
              setHoveredId(intersects[0].object.userData.itemId || null);
            } else {
              setHoveredId(null);
            }
          }
        }
      }

      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
    };

    const onMouseUp = (e) => {
      // ── Sketch draw click ─────────────────────────────────────────────────
      if (sketchModeRef.current && activeSketchToolRef.current && e.button === 0) {
        const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
        const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
        if (Math.hypot(dx, dy) < 5) handleSketchClick(e.clientX, e.clientY);
        return;
      }

      // ── Finish handle drag ────────────────────────────────────────────────
      if (handleDragRef.current) {
        const drag = handleDragRef.current;
        const mesh = objectsRef.current[drag.itemId];
        if (mesh) {
          if (drag.handleType.startsWith("rot")) {
            const newRotation = {
              x: mesh.rotation.x,
              y: mesh.rotation.y,
              z: mesh.rotation.z,
            };
            useStore
              .getState()
              .setItemTransform(drag.itemId, null, null, newRotation);

            // Sync descendant positions and rotations to store
            if (drag.startDescendantPositions && Object.keys(drag.startDescendantPositions).length > 0) {
              const descendantUpdates = Object.keys(drag.startDescendantPositions).map((idStr) => {
                const dMesh = objectsRef.current[parseInt(idStr, 10)];
                if (!dMesh) return null;
                const e = dMesh.rotation;
                return {
                  id: parseInt(idStr, 10),
                  position: { x: dMesh.position.x, y: dMesh.position.y, z: dMesh.position.z },
                  rotation: { x: e.x, y: e.y, z: e.z },
                };
              }).filter(Boolean);
              if (descendantUpdates.length > 0) useStore.getState().setItemsTransform(descendantUpdates);
            }
          } else {
            const newPos = {
              x: mesh.position.x,
              y: mesh.position.y,
              z: mesh.position.z,
            };
            const newScale = {
              x: mesh.scale.x,
              y: mesh.scale.y,
              z: mesh.scale.z,
            };
            useStore
              .getState()
              .setItemTransform(drag.itemId, newPos, newScale, null);

            // Sync descendant positions to store
            if (drag.startDescendantPositions && Object.keys(drag.startDescendantPositions).length > 0) {
              const descendantUpdates = Object.keys(drag.startDescendantPositions).map((idStr) => {
                const dMesh = objectsRef.current[parseInt(idStr, 10)];
                if (!dMesh) return null;
                return { id: parseInt(idStr, 10), position: { x: dMesh.position.x, y: dMesh.position.y, z: dMesh.position.z } };
              }).filter(Boolean);
              if (descendantUpdates.length > 0) {
                useStore.getState().setItemsTransform(descendantUpdates);
              }
            }
          }

          // Debounced history entry
          if (transformDebounceRef.current)
            clearTimeout(transformDebounceRef.current);
          const capturedId = drag.itemId;
          const capturedType = drag.handleType;
          transformDebounceRef.current = setTimeout(() => {
            const currentItem = useStore
              .getState()
              .items.find((i) => i.id === capturedId);
            if (!currentItem) return;
            const label = capturedType.startsWith("rot")
              ? "Rotated"
              : capturedType === "scale"
                ? "Scaled"
                : "Moved";
            useStore.getState().recordTransformHistory(capturedId, label);
          }, 800);
        }
        handleDragRef.current = null;
        return;
      }

      controls.isRotating = false;
      controls.isPanning = false;
      orbitIndicator.visible = false;

      // Sketch placement click
      if (sketchPlacementModeRef.current && e.button === 0) {
        const dx = e.clientX - (controls.mouseDownX || e.clientX);
        const dy = e.clientY - (controls.mouseDownY || e.clientY);
        if (Math.hypot(dx, dy) < 5) {
          const currentCamera = cameraRef.current;
          if (currentCamera) {
            const rect = renderer.domElement.getBoundingClientRect();
            const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycasterRef.current.setFromCamera({ x: nx, y: ny }, currentCamera);

            const objHits = raycasterRef.current.intersectObjects(Object.values(objectsRef.current), false);
            let position, rotation;

            if (objHits.length > 0) {
              const hit = objHits[0];
              const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
              const worldNormal = hit.face.normal.clone().applyMatrix3(normalMatrix).normalize();
              const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), worldNormal);
              const euler = new THREE.Euler().setFromQuaternion(q);
              position = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
              rotation = { x: euler.x, y: euler.y, z: euler.z };
            } else {
              const planeMeshes = sketchPlacementPlanesRef.current.map((p) => p.mesh);
              const planeHits = raycasterRef.current.intersectObjects(planeMeshes, false);
              if (planeHits.length > 0) {
                const hitPlane = sketchPlacementPlanesRef.current.find((p) => p.mesh === planeHits[0].object);
                if (hitPlane) {
                  const hp = planeHits[0].point;
                  position = { x: hp.x, y: hp.y, z: hp.z };
                  rotation = hitPlane.euler;
                }
              }
            }

            if (position && rotation) {
              const hist = useStore.getState().history;
              let maxId = 0;
              hist.forEach((entry) => {
                if (entry.instruction?.type === "create" && entry.instruction.item.id > maxId)
                  maxId = entry.instruction.item.id;
              });
              const id = maxId + 1;
              useStore.getState().addItem({
                id,
                name: `Sketch ${id}`,
                type: "sketch",
                children: [],
                position,
                scale: { x: 1, y: 1, z: 1 },
                rotation,
              });
              useStore.getState().setSketchPlacementMode(false);
            }
          }
        }
        saveCameraState();
        return;
      }

      // Suppress click-to-select/deselect while editing a sketch
      if (sketchModeRef.current) {
        saveCameraState();
        return;
      }

      // Click-to-select (only if mouse barely moved)
      const dx = e.clientX - controls.mouseDownX;
      const dy = e.clientY - controls.mouseDownY;
      if (Math.hypot(dx, dy) < 5) {
        const currentCamera = cameraRef.current;
        if (currentCamera) {
          const rect = renderer.domElement.getBoundingClientRect();
          const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
          const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
          raycasterRef.current.setFromCamera({ x: nx, y: ny }, currentCamera);
          const selectableMeshes = Object.values(objectsRef.current).filter((m) => {
            const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
            return it?.type !== "sketch";
          });
          const intersects = raycasterRef.current.intersectObjects(selectableMeshes, false);
          if (intersects.length > 0) {
            const clickedId = intersects[0].object.userData.itemId || null;
            if (e.shiftKey && clickedId) {
              useStore.getState().addToSelection(clickedId);
            } else {
              selectItem(clickedId);
            }
          } else if (!e.shiftKey) {
            selectItem(null);
          }
        }
      }

      saveCameraState();
    };

    const isMac = /Mac|iPhone|iPad/i.test(navigator.platform);
    let shiftScrollSessionTimer = null;
    const onMouseWheel = (e) => {
      e.preventDefault();
      const currentCamera = cameraRef.current;
      if (!currentCamera) return;

      if (e.ctrlKey && isMac) {
        // macOS trackpad pinch → zoom
        const scale = Math.exp(-e.deltaY * 0.04);
        const tgt = targetRef.current;
        if (currentCamera instanceof THREE.OrthographicCamera) {
          currentCamera.zoom = Math.max(0.05, Math.min(50, currentCamera.zoom * scale));
          currentCamera.updateProjectionMatrix();
        } else {
          const dir = new THREE.Vector3().subVectors(currentCamera.position, tgt);
          const newDist = Math.max(0.5, Math.min(500, dir.length() / scale));
          currentCamera.position.copy(tgt).addScaledVector(dir.normalize(), newDist);
          currentCamera.lookAt(tgt);
        }
        setRotationState(currentCamera.quaternion.clone());
        saveCameraState();
        return;
      }

      if (e.metaKey || (e.ctrlKey && !isMac)) {
        // Cmd+scroll (Mac) or Ctrl+scroll (Windows/Linux) → pan in view plane
        const cam = currentCamera;
        const rect = renderer.domElement.getBoundingClientRect();
        const worldPerPx = cam.isPerspectiveCamera
          ? (2 * cam.position.distanceTo(targetRef.current) * Math.tan((cam.fov * Math.PI) / 360)) / rect.height
          : (cam.top - cam.bottom) / rect.height;
        const forward = new THREE.Vector3();
        cam.getWorldDirection(forward);
        const right = new THREE.Vector3().crossVectors(forward, cam.up).normalize();
        const up = cam.up.clone().normalize();
        const offset = new THREE.Vector3()
          .addScaledVector(right, e.deltaX * worldPerPx)
          .addScaledVector(up, -e.deltaY * worldPerPx);
        cam.position.add(offset);
        targetRef.current.add(offset);
        cam.lookAt(targetRef.current);
        setRotationState(cam.quaternion.clone());
        saveCameraState();
        return;
      }

      if (e.shiftKey) {
        // Shift + scroll → orbit; anchor once at the start of each gesture session
        if (shiftScrollSessionTimer === null) setOrbitAnchor(getOrbitAnchor());
        clearTimeout(shiftScrollSessionTimer);
        shiftScrollSessionTimer = setTimeout(() => { shiftScrollSessionTimer = null; orbitIndicator.visible = false; }, 400);
        const rotSpeed = 0.004;
        controls.targetRotationY += e.deltaX * rotSpeed;
        controls.targetRotationX -= e.deltaY * rotSpeed;
        controls.targetRotationX = Math.max(
          -Math.PI / 2,
          Math.min(Math.PI / 2, controls.targetRotationX),
        );
        const distance = currentCamera.position.distanceTo(targetRef.current);
        currentCamera.position.x =
          targetRef.current.x +
          Math.sin(controls.targetRotationY) *
            Math.cos(controls.targetRotationX) *
            distance;
        currentCamera.position.y =
          targetRef.current.y + Math.sin(controls.targetRotationX) * distance;
        currentCamera.position.z =
          targetRef.current.z +
          Math.cos(controls.targetRotationY) *
            Math.cos(controls.targetRotationX) *
            distance;
        currentCamera.lookAt(targetRef.current);
        setRotationState(currentCamera.quaternion.clone());
      } else if (sketchModeRef.current) {
        // Sketch mode: pan in camera's local right/up plane
        const panSpeed = 0.05;
        const forward = new THREE.Vector3();
        currentCamera.getWorldDirection(forward);
        const right = new THREE.Vector3()
          .crossVectors(forward, currentCamera.up)
          .normalize();
        const offset = new THREE.Vector3()
          .addScaledVector(right, e.deltaX * panSpeed)
          .addScaledVector(currentCamera.up, -e.deltaY * panSpeed);
        currentCamera.position.add(offset);
        targetRef.current.add(offset);
        currentCamera.lookAt(targetRef.current);
      } else {
        // Normal mode: same ground-plane projection as left-mouse pan
        const rect = renderer.domElement.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const groundY = targetRef.current.y;
        const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -groundY);

        const hitAt = (sx, sy) => {
          const nx = ((sx - rect.left) / rect.width) * 2 - 1;
          const ny = -((sy - rect.top) / rect.height) * 2 + 1;
          const r = new THREE.Raycaster();
          r.setFromCamera({ x: nx, y: ny }, currentCamera);
          const h = new THREE.Vector3();
          return r.ray.intersectPlane(groundPlane, h) ? h.clone() : null;
        };

        const h0 = hitAt(cx, cy);
        const h1 = hitAt(cx + 100, cy);
        const h2 = hitAt(cx, cy + 100);

        if (h0 && h1 && h2) {
          const panDxWorld = new THREE.Vector3().subVectors(h1, h0).divideScalar(100);
          const panDyWorld = new THREE.Vector3().subVectors(h2, h0).divideScalar(100);
          const worldOffset = new THREE.Vector3()
            .addScaledVector(panDxWorld, e.deltaX)
            .addScaledVector(panDyWorld, e.deltaY);
          currentCamera.position.x += worldOffset.x;
          currentCamera.position.z += worldOffset.z;
          targetRef.current.x += worldOffset.x;
          targetRef.current.z += worldOffset.z;
        } else {
          // Fallback when ray misses ground: pan vertically
          const panSpeed = 0.05;
          currentCamera.position.y -= e.deltaY * panSpeed;
          targetRef.current.y -= e.deltaY * panSpeed;
        }
        currentCamera.lookAt(targetRef.current);
      }

      saveCameraState();
    };

    const onContextMenu = (e) => e.preventDefault();

    const onModifierUp = (e) => {
      if (e.key === "Meta" || e.key === "Control") {
        if (faceHighlightRef.current) {
          scene.remove(faceHighlightRef.current);
          faceHighlightRef.current.geometry.dispose();
          faceHighlightRef.current.material.dispose();
          faceHighlightRef.current = null;
        }
      }
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape" && sketchPlacementModeRef.current) {
        useStore.getState().setSketchPlacementMode(false);
      }
    };
    document.addEventListener("keyup", onModifierUp);
    document.addEventListener("keydown", onKeyDown);

    renderer.domElement.addEventListener("mousedown", onMouseDown);
    renderer.domElement.addEventListener("mousemove", onMouseMove);
    renderer.domElement.addEventListener("mouseup", onMouseUp);
    renderer.domElement.addEventListener("wheel", onMouseWheel, {
      passive: false,
    });
    renderer.domElement.addEventListener("contextmenu", onContextMenu);

    // ── Pinch-to-zoom ────────────────────────────────────────────────────────
    let pinchDist = null;
    const getPinchDist = (touches) => {
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };
    const onTouchStart = (e) => {
      if (e.touches.length === 2) pinchDist = getPinchDist(e.touches);
    };
    const onTouchMove = (e) => {
      if (e.touches.length !== 2 || pinchDist === null) return;
      e.preventDefault();
      const newDist = getPinchDist(e.touches);
      const scale = newDist / pinchDist;
      pinchDist = newDist;
      const cam = cameraRef.current;
      const tgt = targetRef.current;
      if (cam instanceof THREE.OrthographicCamera) {
        cam.zoom = Math.max(0.05, Math.min(50, cam.zoom * scale));
        cam.updateProjectionMatrix();
      } else {
        const dir = new THREE.Vector3().subVectors(cam.position, tgt);
        const newCamDist = Math.max(0.5, Math.min(500, dir.length() / scale));
        cam.position.copy(tgt).addScaledVector(dir.normalize(), newCamDist);
        cam.lookAt(tgt);
      }
      setRotationState(cam.quaternion.clone());
    };
    const onTouchEnd = (e) => {
      if (e.touches.length < 2) pinchDist = null;
    };
    renderer.domElement.addEventListener("touchstart", onTouchStart, { passive: true });
    renderer.domElement.addEventListener("touchmove", onTouchMove, { passive: false });
    renderer.domElement.addEventListener("touchend", onTouchEnd);

    const animate = () => {
      requestAnimationFrame(animate);

      if (cameraAnimRef.current) {
        const anim = cameraAnimRef.current;
        const t = Math.min(1, (Date.now() - anim.startTime) / anim.duration);
        const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        cameraRef.current.position.lerpVectors(anim.startPos, anim.endPos, ease);
        targetRef.current.lerpVectors(anim.startTarget, anim.endTarget, ease);
        cameraRef.current.up.lerpVectors(anim.startUp, anim.endUp, ease).normalize();
        cameraRef.current.lookAt(targetRef.current);
        setRotationState(cameraRef.current.quaternion.clone());
        if (t >= 1) {
          if (anim.onComplete) anim.onComplete();
          cameraAnimRef.current = null;
        }
      }

      gridMaterial.uniforms.uCameraPos.value.copy(cameraRef.current.position);
      if (composerRef.current) {
        composerRef.current.render();
      } else {
        renderer.render(scene, cameraRef.current);
      }
    };
    animate();

    return () => {
      clearTimeout(shiftScrollSessionTimer);
      orbitIndicatorGeo.dispose();
      orbitIndicatorMat.dispose();
      window.removeEventListener("resize", handleResize);
      document.removeEventListener("keyup", onModifierUp);
      document.removeEventListener("keydown", onKeyDown);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      renderer.domElement.removeEventListener("mousemove", onMouseMove);
      renderer.domElement.removeEventListener("mouseup", onMouseUp);
      renderer.domElement.removeEventListener("wheel", onMouseWheel);
      renderer.domElement.removeEventListener("contextmenu", onContextMenu);
      if (faceHighlightRef.current) {
        faceHighlightRef.current.geometry.dispose();
        faceHighlightRef.current.material.dispose();
        faceHighlightRef.current = null;
      }
      if (transformDebounceRef.current)
        clearTimeout(transformDebounceRef.current);
      saveCameraState();
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
      if (containerRef.current)
        containerRef.current.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, [theme, setHoveredId]);

  useEffect(() => {
    if (axisGroupRef.current) axisGroupRef.current.visible = axisVisible;
  }, [axisVisible]);

  // Projection mode switch
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
    if (composerRef.current && composerRef.current.passes.length > 0) {
      composerRef.current.passes[0].camera = newCamera;
    }
    renderer.clear();
    renderer.render(sceneRef.current, newCamera);
  }, [projectionMode]);

  // Camera reset on new/load document
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

  // Sketch placement mode: show 3 axis planes for the user to click
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
      const geo = new THREE.PlaneGeometry(SIZE, SIZE);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(center);
      mesh.rotation.set(rx, ry, rz);
      scene.add(mesh);
      sketchPlacementPlanesRef.current.push({ mesh, euler: { x: rx, y: ry, z: rz }, name });
    });

    return clearPlanes;
  }, [sketchPlacementMode]);

  // Rebuild scene objects when items change
  useEffect(() => {
    if (!sceneRef.current) return;
    Object.values(objectsRef.current).forEach((mesh) => {
      sceneRef.current.remove(mesh);
      mesh.geometry.dispose();
      if (Array.isArray(mesh.material))
        mesh.material.forEach((m) => m.dispose());
      else mesh.material.dispose();
      mesh.children.forEach((child) => {
        child.geometry && child.geometry.dispose();
        child.material && child.material.dispose();
      });
    });
    objectsRef.current = {};
    originalMaterialsRef.current = {};

    items.forEach((item) => {
      let geometry;
      switch (item.type) {
        case "cube":
          geometry = new THREE.BoxGeometry(2, 2, 2);
          break;
        case "sphere":
          geometry = new THREE.SphereGeometry(1.5, 32, 32);
          break;
        case "sketch":
          geometry = new THREE.PlaneGeometry(3, 3);
          break;
        case "csg": {
          if (!item.geometryData) return;
          const { positions, normals, indices } = item.geometryData;
          geometry = new THREE.BufferGeometry();
          geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
          if (normals) geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
          if (indices) geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
          if (!normals) geometry.computeVertexNormals();
          break;
        }
        default:
          return;
      }

      const color = 0xe0e0e0;
      const material = item.type === "sketch"
        ? new THREE.MeshStandardMaterial({
            color: 0x88aaff,
            transparent: true,
            opacity: 0.18,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        : new THREE.MeshStandardMaterial({
            color,
            metalness: 0.3,
            roughness: 0.5,
          });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = item.type !== "sketch";
      mesh.receiveShadow = item.type !== "sketch";
      mesh.userData.itemId = item.id;

      // Use stored position/scale/rotation if present
      const p = item.position;
      mesh.position.set(p ? p.x : 0, p ? p.y : 2, p ? p.z : 0);
      mesh.scale.setScalar(item.scale ? item.scale.x : 1);
      const r = item.rotation;
      if (r) mesh.rotation.set(r.x || 0, r.y || 0, r.z || 0);

      if (item.type === "sphere") {
        const outlineMesh = new THREE.Mesh(
          geometry,
          new THREE.MeshBasicMaterial({
            color: 0x333333,
            side: THREE.BackSide,
          }),
        );
        outlineMesh.scale.setScalar(1.002);
        mesh.add(outlineMesh);
      } else if (item.type !== "sketch") {
        const edgeMesh = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry),
          new THREE.LineBasicMaterial({ color: 0x333333, linewidth: 2 }),
        );
        mesh.add(edgeMesh);
      }

      mesh.visible = item.visible !== false;
      sceneRef.current.add(mesh);
      objectsRef.current[item.id] = mesh;
      originalMaterialsRef.current[item.id] = {
        color: new THREE.Color(color),
        metalness: 0.2,
        roughness: 0.2,
        emissive: new THREE.Color(0x000000),
      };
    });

    // Re-apply smooth materials to newly built meshes if smooth mode is active
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
          color: col,
          metalness: 0.15,
          roughness: 0.3,
          clearcoat: 1.0,
          clearcoatRoughness: 0.1,
          envMapIntensity: 1.2,
        });
        mesh.children.forEach((child) => {
          child.visible = false;
        });
      });
    }
  }, [items]);

  // Create/update transform handles when selection or items change
  // (runs after scene rebuild since it's declared after the items effect)
  useEffect(() => {
    if (!sceneRef.current) return;

    // Remove old handles
    handlesRef.current.forEach(({ mesh }) => {
      sceneRef.current.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    });
    handlesRef.current = [];
    handleDragRef.current = null;

    // Remove old bounding box
    if (boundingBoxRef.current) {
      const { boxMesh, labelX, labelY, labelZ } = boundingBoxRef.current;
      sceneRef.current.remove(boxMesh);
      sceneRef.current.remove(labelX.sprite);
      sceneRef.current.remove(labelY.sprite);
      sceneRef.current.remove(labelZ.sprite);
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
    // No handles when multiple items are selected
    if (selectedIdsRef.current.length > 1) return;
    const mesh = objectsRef.current[selectedId];
    if (!mesh) return;
    const item = items.find((i) => i.id === selectedId);
    if (!item) return;
    // No transform handles for sketch planes
    if (item.type === "sketch") return;

    const ext = getObjectExtent(item.type, mesh.scale.x);
    HANDLE_CONFIGS.forEach(({ type, color, dir }) => {
      const geo = new THREE.SphereGeometry(0.12, 10, 10);
      const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
      const hMesh = new THREE.Mesh(geo, mat);
      hMesh.renderOrder = 999;
      hMesh.userData.isHandle = true;
      hMesh.position.copy(mesh.position).addScaledVector(dir, ext + 0.5);
      sceneRef.current.add(hMesh);
      handlesRef.current.push({ mesh: hMesh, type, dir: dir.clone() });
    });

    // Rotation torus handles
    const torusRadius = ext + 0.85;
    [
      { type: "rotX", color: 0xff4444, rx: 0, ry: Math.PI / 2, rz: 0 },
      { type: "rotY", color: 0x4488ff, rx: Math.PI / 2, ry: 0, rz: 0 },
      { type: "rotZ", color: 0x44ff44, rx: 0, ry: 0, rz: 0 },
    ].forEach(({ type, color, rx, ry, rz }) => {
      const geo = new THREE.TorusGeometry(torusRadius, 0.045, 6, 64);
      const mat = new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      const torus = new THREE.Mesh(geo, mat);
      torus.renderOrder = 998;
      torus.userData.isHandle = true;
      torus.position.copy(mesh.position);
      torus.rotation.set(rx, ry, rz);
      sceneRef.current.add(torus);
      handlesRef.current.push({ mesh: torus, type, dir: null });
    });

    // Create bounding box
    const dim = getObjectDimensions(item.type, mesh.scale.x);
    const boxGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const boxMat = new THREE.LineBasicMaterial({
      color: 0x88ccff,
      depthTest: false,
      transparent: true,
      opacity: 0.7,
    });
    const boxMesh2 = new THREE.LineSegments(boxGeo, boxMat);
    boxMesh2.renderOrder = 998;
    boxMesh2.scale.set(dim.w, dim.h, dim.d);
    boxMesh2.position.copy(mesh.position);
    sceneRef.current.add(boxMesh2);

    // Create dimension labels
    const mmX = Math.round(dim.w * MM_PER_UNIT);
    const mmY = Math.round(dim.h * MM_PER_UNIT);
    const mmZ = Math.round(dim.d * MM_PER_UNIT);
    const labelX = makeDimSprite(mmX + "mm", "#ff4444");
    const labelY = makeDimSprite(mmY + "mm", "#4488ff");
    const labelZ = makeDimSprite(mmZ + "mm", "#44ff44");
    sceneRef.current.add(labelX.sprite);
    sceneRef.current.add(labelY.sprite);
    sceneRef.current.add(labelZ.sprite);

    const newBB = { boxMesh: boxMesh2, labelX, labelY, labelZ };
    placeDimLabels(newBB, mesh.position, dim);
    boundingBoxRef.current = newBB;

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

  // Sketch plane mode: top-down view, measurement grid, hide other objects
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
        // Clear any active sketch drawing
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
        // Clear shapes group
        if (sketchShapesGroupRef.current) {
          scene.remove(sketchShapesGroupRef.current);
          sketchShapesGroupRef.current.traverse((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
          });
          sketchShapesGroupRef.current = null;
        }
        // Restore axis visibility
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
          const savedPos = new THREE.Vector3(saved.positionX, saved.positionY, saved.positionZ);
          const savedTarget = new THREE.Vector3(saved.targetX, saved.targetY, saved.targetZ);
          cameraAnimRef.current = {
            startPos: camera.position.clone(),
            endPos: savedPos,
            startTarget: targetRef.current.clone(),
            endTarget: savedTarget,
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
      // Hide axis indicators while in sketch mode
      if (axisGroupRef.current) axisGroupRef.current.visible = false;
    }

    // Point camera straight at the plane normal
    const worldNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion).normalize();
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
          controls.targetRotationX = dist > 0 ? Math.asin(Math.max(-1, Math.min(1, dp.y / dist))) : 0;
          controls.targetRotationY = Math.atan2(dp.x, dp.z);
          setRotationState(cameraRef.current.quaternion.clone());
        },
      };
    }

    if (planeRef.current) planeRef.current.visible = false;

    Object.entries(objectsRef.current).forEach(([idStr, m]) => {
      if (parseInt(idStr) === selectedId) {
        m.visible = true;
        m.material.transparent = true;
        m.material.opacity = 0.12;
        m.material.needsUpdate = true;
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
      gridGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(i, -GRID_HALF, 0),
          new THREE.Vector3(i, GRID_HALF, 0),
        ]),
        lineMat.clone()
      ));
      gridGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-GRID_HALF, i, 0),
          new THREE.Vector3(GRID_HALF, i, 0),
        ]),
        lineMat.clone()
      ));
    }

    gridGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-GRID_HALF, 0, 0),
        new THREE.Vector3(GRID_HALF, 0, 0),
      ]),
      new THREE.LineBasicMaterial({ color: 0xff4444 })
    ));
    gridGroup.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -GRID_HALF, 0),
        new THREE.Vector3(0, GRID_HALF, 0),
      ]),
      new THREE.LineBasicMaterial({ color: 0x4488ff })
    ));

    for (let i = -GRID_HALF; i <= GRID_HALF; i++) {
      if (i === 0) continue;
      const xLbl = makeMeasureLabel(`${i * MM_PER_UNIT}`, "#ff6666");
      xLbl.position.set(i, -0.42, 0.01);
      gridGroup.add(xLbl);
      const yLbl = makeMeasureLabel(`${i * MM_PER_UNIT}`, "#6699ff");
      yLbl.position.set(-0.58, i, 0.01);
      gridGroup.add(yLbl);
    }

    gridGroup.position.copy(mesh.position);
    gridGroup.quaternion.copy(mesh.quaternion);
    scene.add(gridGroup);
    sketchGridGroupRef.current = gridGroup;
  }, [selectedId, items]);

  // Rebuild sketch shape lines when the selected sketch's shapes change
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

    const selItem = items.find((i) => i.id === selectedId);
    if (selItem?.type !== "sketch") return;
    const sketchMesh = objectsRef.current[selectedId];
    if (!sketchMesh) return;
    const shapes = selItem.shapes || [];
    if (shapes.length === 0) return;

    const group = new THREE.Group();
    shapes.forEach((shape) => {
      const pts = getSketchShapePoints(shape, sketchMesh);
      if (pts.length < 2) return;
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: 0x88aaff, depthTest: false });
      const line = new THREE.Line(geo, mat);
      line.renderOrder = 1001;
      group.add(line);
    });
    scene.add(group);
    sketchShapesGroupRef.current = group;
  }, [selectedId, items]);

  // Hover / selection highlight
  useEffect(() => {
    Object.entries(objectsRef.current).forEach(([itemId, mesh]) => {
      const id = parseInt(itemId);
      if (!mesh.material.emissive) return;
      if (id === selectedId) {
        mesh.material.emissive.setHex(0x006666);
      } else if (selectedIds.includes(id)) {
        mesh.material.emissive.setHex(0x550011);
      } else if (id === hoveredId) {
        mesh.material.emissive.setHex(0x444444);
      } else {
        mesh.material.emissive.setHex(0x000000);
      }
      mesh.material.needsUpdate = true;
    });
  }, [hoveredId, selectedId, selectedIds]);

  // Render mode
  useEffect(() => {
    if (!sceneRef.current || !rendererRef.current) return;
    const scene = sceneRef.current;
    const renderer = rendererRef.current;

    if (renderMode === "smooth") {
      if (!envTextureRef.current) {
        const pmremGen = new THREE.PMREMGenerator(renderer);
        pmremGen.compileEquirectangularShader();
        const roomEnv = new RoomEnvironment();
        envTextureRef.current = pmremGen.fromScene(roomEnv).texture;
        pmremGen.dispose();
        roomEnv.dispose();
      }
      scene.environment = envTextureRef.current;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.2;

      // Gradient background: dark blue → dark purple
      const bgCanvas = document.createElement("canvas");
      bgCanvas.width = 2;
      bgCanvas.height = 512;
      const bgCtx = bgCanvas.getContext("2d");
      const grad = bgCtx.createLinearGradient(0, 0, 0, 512);
      grad.addColorStop(0, "#0a0a2e");
      grad.addColorStop(1, "#1a0828");
      bgCtx.fillStyle = grad;
      bgCtx.fillRect(0, 0, 2, 512);
      const bgTex = new THREE.CanvasTexture(bgCanvas);
      bgTex.needsUpdate = true;
      scene.background = bgTex;

      // Hide axis, ground grid, and sketch objects
      if (axisGroupRef.current) axisGroupRef.current.visible = false;
      if (planeRef.current) planeRef.current.visible = false;
      sketchPlacementPlanesRef.current.forEach(({ mesh }) => { mesh.visible = false; });

      if (!composerRef.current && cameraRef.current) {
        const composer = new EffectComposer(renderer);
        composer.addPass(new RenderPass(scene, cameraRef.current));
        const bloomPass = new UnrealBloomPass(
          new THREE.Vector2(
            renderer.domElement.clientWidth,
            renderer.domElement.clientHeight,
          ),
          0.25,
          0.5,
          0.85,
        );
        composer.addPass(bloomPass);
        composer.addPass(new OutputPass());
        composerRef.current = composer;
      }

      Object.values(objectsRef.current).forEach((mesh) => {
        const itemData = itemsRef.current.find((i) => i.id === mesh.userData.itemId);
        if (itemData?.type === "sketch") {
          mesh.visible = false;
          return;
        }
        const orig = originalMaterialsRef.current[mesh.userData.itemId];
        const col = orig ? orig.color.clone() : new THREE.Color(0xe0e0e0);
        if (mesh.material) mesh.material.dispose();
        mesh.material = new THREE.MeshPhysicalMaterial({
          color: col,
          metalness: 0.15,
          roughness: 0.3,
          clearcoat: 1.0,
          clearcoatRoughness: 0.1,
          envMapIntensity: 1.2,
        });
        mesh.children.forEach((child) => {
          child.visible = false;
        });
      });
    } else {
      scene.environment = null;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.toneMappingExposure = 1.0;
      if (composerRef.current) {
        composerRef.current.dispose();
        composerRef.current = null;
      }

      // Restore solid background colour
      const bgColor = useStore.getState().theme === "light" ? 0xe8e8e8 : 0x1a1a1a;
      scene.background = new THREE.Color(bgColor);

      // Restore axis and grid visibility
      if (axisGroupRef.current) axisGroupRef.current.visible = useStore.getState().axisVisible;
      if (planeRef.current && !sketchModeRef.current) planeRef.current.visible = true;
      sketchPlacementPlanesRef.current.forEach(({ mesh }) => { mesh.visible = true; });

      Object.values(objectsRef.current).forEach((mesh) => {
        const itemData = itemsRef.current.find((i) => i.id === mesh.userData.itemId);
        if (itemData?.type === "sketch") {
          mesh.visible = true;
          return;
        }
        const orig = originalMaterialsRef.current[mesh.userData.itemId];
        const col = orig ? orig.color.clone() : new THREE.Color(0xe0e0e0);
        if (mesh.material) mesh.material.dispose();
        mesh.material = new THREE.MeshStandardMaterial({
          color: col,
          metalness: 0.3,
          roughness: 0.5,
        });
        mesh.material.wireframe = renderMode === "wireframe";
        mesh.children.forEach((child) => {
          child.visible = true;
        });
      });
    }
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
        <div className="sketch-placement-hint">
          Click to set the start point
        </div>
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
        <RotationWidget
          rotationState={rotationState}
          onOrientationChange={handleOrientationChange}
        />
      )}
    </div>
  );
};

export default Viewport;
