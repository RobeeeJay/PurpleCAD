import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { useStore } from "../store";
import {
  getObjectDimensions,
  getObjectExtent,
  redrawDimSprite,
  placeDimLabels,
  buildSketchShape,
  getSketchShapePoints,
  sketchDimText,
  MM_PER_UNIT,
  getSnapPoints,
  getShapeLength,
  moveShapePoint,
  getShapePoint,
  rebuildConstraintIconsForDrag,
  rebuildPointDotsForDrag,
  polyArea,
  fullCircleSegments,
  DISPLAY_PRECISION_MM,
} from "./sceneObjects.js";
import {
  applyHVEnforcement,
  projectOntoLine,
  enforceConstraints,
  norm2,
  buildBevelArc,
} from "./sketchConstraints.js";

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
    orbitIndicator,
    gridMaterial,
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

  // ── Snap helpers ──────────────────────────────────────────────────────────
  let currentSnapIndicator = null;
  const clearSnapIndicator = () => {
    if (currentSnapIndicator) {
      scene.remove(currentSnapIndicator);
      currentSnapIndicator.geometry.dispose();
      currentSnapIndicator.material.dispose();
      currentSnapIndicator = null;
    }
  };

  const showSnapIndicator = (snapLocal, sketchMesh) => {
    clearSnapIndicator();
    const SNAP_R = 0.18;
    const toW = (x, y) => {
      const v = new THREE.Vector3(x, y, 0.006);
      v.applyQuaternion(sketchMesh.quaternion);
      v.add(sketchMesh.position);
      return v;
    };
    const circlePts = Array.from({ length: 17 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return toW(
        snapLocal.x + Math.cos(a) * SNAP_R,
        snapLocal.y + Math.sin(a) * SNAP_R,
      );
    });
    const geo = new THREE.BufferGeometry().setFromPoints(circlePts);
    const mat = new THREE.LineBasicMaterial({
      color: 0xffdd00,
      depthTest: false,
    });
    currentSnapIndicator = new THREE.Line(geo, mat);
    currentSnapIndicator.renderOrder = 1005;
    scene.add(currentSnapIndicator);
  };

  const findSnap = (screenX, screenY, shapes, sketchMesh, thresholdPx = 14) => {
    if (!shapes || shapes.length === 0) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    const snapPts = getSnapPoints(shapes);
    let best = null;
    let bestDist = thresholdPx;
    for (const pt of snapPts) {
      const world = new THREE.Vector3(pt.x, pt.y, 0.003);
      world.applyQuaternion(sketchMesh.quaternion);
      world.add(sketchMesh.position);
      const ndc = world.clone().project(cameraRef.current);
      const sx = ((ndc.x + 1) / 2) * rect.width + rect.left;
      const sy = ((-ndc.y + 1) / 2) * rect.height + rect.top;
      const dist = Math.hypot(screenX - sx, screenY - sy);
      if (dist < bestDist) {
        bestDist = dist;
        best = pt;
      }
    }
    return best;
  };

  const makePreviewLine2 = (pts, color = 0x88ccff, opacity = 0.75) => {
    if (pts.length < 2) return null;
    const geo = new LineGeometry();
    geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    const mat = new LineMaterial({
      color,
      linewidth: 1.5,
      transparent: true,
      opacity,
      depthTest: false,
      resolution: renderer.getSize(new THREE.Vector2()),
    });
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 1002;
    return line;
  };

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

  const clearHoverFills = () => {
    const g = sketchShapesGroupRef?.current;
    if (g)
      g.children.forEach((c) => {
        if (c.userData.isRegionFill) c.visible = false;
      });
  };

  const updateHoverFills = (screenX, screenY) => {
    const g = sketchShapesGroupRef?.current;
    if (!g) return;
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!sketchMesh) {
      clearHoverFills();
      return;
    }
    const localPt = screenToSketchLocal(screenX, screenY, sketchMesh);
    if (!localPt) {
      clearHoverFills();
      return;
    }
    // First pass: determine which fill is the best match.
    // Priority: highest renderOrder first; among equal renderOrders prefer smallest
    // polygon area so that a small inner region (e.g. a circle sitting inside a triangle)
    // always wins over the triangle when both are at the same nesting depth.
    let bestFill = null;
    for (const c of g.children) {
      if (!c.userData.isRegionFill) continue;
      const inOuter = pointInPolygon2D(localPt, c.userData.polygon2D);
      const inHole = (c.userData.holes2D || []).some((h) =>
        pointInPolygon2D(localPt, h),
      );
      if (inOuter && !inHole) {
        const cOrder = c.renderOrder ?? 0;
        const bOrder = bestFill ? (bestFill.renderOrder ?? 0) : -1;
        const cArea = polyArea(c.userData.polygon2D);
        const bArea = bestFill
          ? polyArea(bestFill.userData.polygon2D)
          : Infinity;
        if (
          !bestFill ||
          cOrder > bOrder ||
          (cOrder === bOrder && cArea < bArea)
        )
          bestFill = c;
      }
    }
    // Second pass: show only the best match
    g.children.forEach((c) => {
      if (!c.userData.isRegionFill) return;
      c.visible = c === bestFill;
    });
  };

  // ── Sketch element hover highlights ──────────────────────────────────────
  let hoveredSketchLine = null;
  let hoveredSketchLineOrigColor = null;

  const clearHoverLineHighlight = () => {
    if (hoveredSketchLine) {
      hoveredSketchLine.material.color.setHex(
        hoveredSketchLineOrigColor ?? 0x88aaff,
      );
      hoveredSketchLine = null;
      hoveredSketchLineOrigColor = null;
    }
  };

  // ── Constraint icon hover highlights ─────────────────────────────────────
  let hoveredConstraintLines = []; // [{ lineObj, origColor }]
  let selectedConstraintIdx = null;
  let selectedConstraintLineRefs = []; // [{ lineObj, origColor }]

  const constraintTypeColor = (type) =>
    ({
      coincident: 0xffaa00,
      distance: 0xffdd44,
      onLine: 0x00aaff,
      horizontal: 0x00ddaa,
      vertical: 0x00ddaa,
    })[type] ?? 0xffffff;

  const CONSTRAINT_SEL_COLOR = 0xff4444;

  const clearConstraintSelection = () => {
    selectedConstraintLineRefs.forEach(({ lineObj, origColor }) => {
      if (lineObj.material?.color) lineObj.material.color.setHex(origColor);
    });
    selectedConstraintLineRefs = [];
    if (selectedConstraintIdx !== null) {
      const g = sketchShapesGroupRef?.current;
      if (g) {
        for (const o of g.children) {
          if (
            o.userData.isConstraintObj &&
            o.userData.constraintIdx === selectedConstraintIdx &&
            o.material?.color &&
            !o.isSprite
          ) {
            o.material.color.setHex(
              constraintTypeColor(o.userData.constraintType),
            );
          }
        }
      }
    }
    selectedConstraintIdx = null;
  };

  const applyConstraintSelectionVisual = () => {
    if (selectedConstraintIdx === null) return;
    const g = sketchShapesGroupRef?.current;
    if (!g) return;
    for (const o of g.children) {
      if (
        o.userData.isConstraintObj &&
        o.userData.constraintIdx === selectedConstraintIdx &&
        o.material?.color &&
        !o.isSprite
      ) {
        o.material.color.setHex(CONSTRAINT_SEL_COLOR);
      }
    }
    const taggedObj = g.children.find(
      (o) =>
        o.userData.isConstraint &&
        o.userData.constraintIdx === selectedConstraintIdx,
    );
    (taggedObj?.userData.constraintShapeIndices || []).forEach((idx) => {
      const lineObj = g.children.find(
        (o) =>
          o.userData.shapeIdx === idx &&
          !o.userData.isConstraintObj &&
          o.material?.color,
      );
      if (!lineObj) return;
      selectedConstraintLineRefs.push({
        lineObj,
        origColor: lineObj.material.color.getHex(),
      });
      lineObj.material.color.setHex(CONSTRAINT_SEL_COLOR);
    });
  };

  const selectConstraint = (constraintIdx) => {
    const isSame = selectedConstraintIdx === constraintIdx;
    clearConstraintSelection();
    if (!isSame) {
      selectedConstraintIdx = constraintIdx;
      applyConstraintSelectionVisual();
    }
  };

  const clearConstraintHoverHighlight = () => {
    hoveredConstraintLines.forEach(({ lineObj, origColor }) => {
      if (lineObj.material && lineObj.material.color)
        lineObj.material.color.setHex(origColor);
    });
    hoveredConstraintLines = [];
  };

  const applyConstraintHoverHighlight = (shapeIndices, color) => {
    clearConstraintHoverHighlight();
    clearHoverLineHighlight();
    const g = sketchShapesGroupRef?.current;
    if (!g) return;
    shapeIndices.forEach((idx) => {
      const lineObj = g.children.find(
        (c) => c.userData.shapeIdx === idx && c.material && c.material.color,
      );
      if (!lineObj) return;
      hoveredConstraintLines.push({
        lineObj,
        origColor: lineObj.material.color.getHex(),
      });
      lineObj.material.color.setHex(color);
    });
  };

  const applyHoverLineHighlight = (lineObj) => {
    if (hoveredSketchLine === lineObj) return;
    clearHoverLineHighlight();
    hoveredSketchLineOrigColor = lineObj.material.color.getHex();
    lineObj.material.color.setHex(0xbbddff);
    hoveredSketchLine = lineObj;
  };

  let currentHoverPointIndicator = null;
  const clearHoverPointIndicator = () => {
    if (currentHoverPointIndicator) {
      scene.remove(currentHoverPointIndicator);
      currentHoverPointIndicator.geometry.dispose();
      currentHoverPointIndicator.material.dispose();
      currentHoverPointIndicator = null;
    }
  };

  const showHoverPointIndicator = (snapPt, sketchMesh) => {
    clearHoverPointIndicator();
    const R = 0.22;
    const toW = (x, y) => {
      const v = new THREE.Vector3(x, y, 0.007);
      v.applyQuaternion(sketchMesh.quaternion);
      v.add(sketchMesh.position);
      return v;
    };
    const pts = Array.from({ length: 17 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return toW(snapPt.x + Math.cos(a) * R, snapPt.y + Math.sin(a) * R);
    });
    const mat = new THREE.LineBasicMaterial({
      color: 0x00ddff,
      depthTest: false,
    });
    currentHoverPointIndicator = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      mat,
    );
    currentHoverPointIndicator.renderOrder = 1006;
    scene.add(currentHoverPointIndicator);
  };

  const updateSketchHover = (screenX, screenY) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!sketchMesh) {
      clearHoverLineHighlight();
      clearHoverPointIndicator();
      clearConstraintHoverHighlight();
      renderer.domElement.style.cursor = "";
      return;
    }

    // ── Constraint icon hover (screen-space distance check) ──────────────────
    const CONSTRAINT_HIT_PX = 14;
    const sketchGroup = sketchShapesGroupRef?.current;
    if (sketchGroup) {
      const rect = renderer.domElement.getBoundingClientRect();
      for (const cObj of sketchGroup.children) {
        if (!cObj.userData.isConstraint) continue;
        const lp = cObj.userData.constraintIconLocalPos;
        if (!lp) continue;
        const worldPt = new THREE.Vector3(lp.x, lp.y, 0.005)
          .applyQuaternion(sketchMesh.quaternion)
          .add(sketchMesh.position);
        const ndc = worldPt.clone().project(cameraRef.current);
        const sx = ((ndc.x + 1) / 2) * rect.width + rect.left;
        const sy = ((-ndc.y + 1) / 2) * rect.height + rect.top;
        if (Math.hypot(screenX - sx, screenY - sy) < CONSTRAINT_HIT_PX) {
          applyConstraintHoverHighlight(
            cObj.userData.constraintShapeIndices,
            cObj.userData.constraintColor,
          );
          clearHoverPointIndicator();
          renderer.domElement.style.cursor = "default";
          return;
        }
      }
    }
    clearConstraintHoverHighlight();

    // ── Point hover takes priority over line hover ────────────────────────────
    const snap = findSnap(screenX, screenY, selItem?.shapes || [], sketchMesh);
    if (snap) {
      showHoverPointIndicator(snap, sketchMesh);
      clearHoverLineHighlight();
      renderer.domElement.style.cursor = "grab";
      return;
    }
    clearHoverPointIndicator();

    // ── Line hover ────────────────────────────────────────────────────────────
    if (sketchGroup) {
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
      const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
      const ray = new THREE.Raycaster();
      ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
      const lineObjs = sketchGroup.children.filter(
        (c) => c.userData.shapeIdx != null,
      );
      const hits = hitTestSketchLines(ray, lineObjs);
      if (hits.length > 0) {
        applyHoverLineHighlight(hits[0].object);
        renderer.domElement.style.cursor = "grab";
        return;
      }
    }
    clearHoverLineHighlight();
    renderer.domElement.style.cursor = "";
  };

  const clearAllSketchHover = () => {
    clearHoverLineHighlight();
    clearHoverPointIndicator();
    clearConstraintHoverHighlight();
    renderer.domElement.style.cursor = "";
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

  // ── Sketch element selection + coincident constraints ─────────────────────
  let sketchSelectionOverlay = null;
  let coincidentFirstOverlay = null;
  let multiSelectedIndices = [];
  let multiSelectOverlays = [];
  let marqueeStartScreen = null;
  let marqueeActive = false;
  let marqueeRectObj = null;
  let lastClickTime = 0;
  let lastClickX = 0;
  let lastClickY = 0;
  let sketchClipboard = null; // { shapes: [...], constraints: [...] }

  const clearSketchSelectionOverlay = () => {
    if (sketchSelectionOverlay) {
      scene.remove(sketchSelectionOverlay);
      if (sketchSelectionOverlay.geometry)
        sketchSelectionOverlay.geometry.dispose();
      if (sketchSelectionOverlay.material)
        sketchSelectionOverlay.material.dispose();
      sketchSelectionOverlay = null;
    }
  };

  const clearCoincidentFirstOverlay = () => {
    if (coincidentFirstOverlay) {
      scene.remove(coincidentFirstOverlay);
      coincidentFirstOverlay.geometry.dispose();
      coincidentFirstOverlay.material.dispose();
      coincidentFirstOverlay = null;
    }
  };

  const makeRingOverlay = (
    localPt,
    sketchMesh,
    color,
    R = 0.25,
    zOff = 0.009,
  ) => {
    const toW = (x, y) => {
      const v = new THREE.Vector3(x, y, zOff);
      v.applyQuaternion(sketchMesh.quaternion);
      v.add(sketchMesh.position);
      return v;
    };
    const pts = Array.from({ length: 17 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return toW(localPt.x + Math.cos(a) * R, localPt.y + Math.sin(a) * R);
    });
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, depthTest: false }),
    );
    line.renderOrder = 1007;
    return line;
  };

  const sketchSelectPoint = (snap, sketchMesh) => {
    clearSketchSelectionOverlay();
    sketchSelectionOverlay = makeRingOverlay(
      { x: snap.x, y: snap.y },
      sketchMesh,
      0x00ff88,
    );
    scene.add(sketchSelectionOverlay);
    useStore.getState().setSelectedSketchElement({
      type: "point",
      shapeIdx: snap.shapeIdx,
      pointKey: snap.pointKey,
    });
  };

  const sketchSelectLine = (shapeIdx, shape, sketchMesh) => {
    clearSketchSelectionOverlay();
    const pts = getSketchShapePoints(shape, sketchMesh);
    if (pts.length >= 2) {
      const geo = new LineGeometry();
      geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
      const mat = new LineMaterial({
        color: 0x00ff88,
        linewidth: 2.5,
        depthTest: false,
        resolution: renderer.getSize(new THREE.Vector2()),
      });
      sketchSelectionOverlay = new Line2(geo, mat);
      sketchSelectionOverlay.computeLineDistances();
      sketchSelectionOverlay.renderOrder = 1005;
      scene.add(sketchSelectionOverlay);
    }
    useStore.getState().setSelectedSketchElement({ type: "line", shapeIdx });
  };

  const clearMarqueeRect = () => {
    if (marqueeRectObj) {
      scene.remove(marqueeRectObj);
      marqueeRectObj.geometry.dispose();
      marqueeRectObj.material.dispose();
      marqueeRectObj = null;
    }
  };

  const clearMultiSelectOverlays = () => {
    useStore.getState().setSketchMultiSelectedIndices([]);
    multiSelectOverlays.forEach((o) => {
      scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    multiSelectOverlays = [];
  };

  const showMultiSelectOverlays = (indices) => {
    clearMultiSelectOverlays();
    useStore.getState().setSketchMultiSelectedIndices([...indices]);
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    const shapes = selItem.shapes || [];
    indices.forEach((idx) => {
      const shape = shapes[idx];
      if (!shape) return;
      const pts = getSketchShapePoints(shape, sketchMesh);
      if (pts.length < 2) return;
      const geo = new LineGeometry();
      geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
      const mat = new LineMaterial({
        color: 0x44aaff,
        linewidth: 2.5,
        depthTest: false,
        resolution: renderer.getSize(new THREE.Vector2()),
      });
      const line = new Line2(geo, mat);
      line.computeLineDistances();
      line.renderOrder = 1005;
      scene.add(line);
      multiSelectOverlays.push(line);
    });
  };

  const updateMarquee = (screenX, screenY) => {
    clearMarqueeRect();
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh || !marqueeStartScreen) return;
    const p1 = screenToSketchLocal(
      marqueeStartScreen.x,
      marqueeStartScreen.y,
      sketchMesh,
    );
    const p2 = screenToSketchLocal(screenX, screenY, sketchMesh);
    if (!p1 || !p2) return;
    const toW = (lx, ly) => {
      const v = new THREE.Vector3(lx, ly, 0.008);
      v.applyQuaternion(sketchMesh.quaternion);
      v.add(sketchMesh.position);
      return v;
    };
    const corners = [
      toW(p1.x, p1.y),
      toW(p2.x, p1.y),
      toW(p2.x, p2.y),
      toW(p1.x, p2.y),
      toW(p1.x, p1.y),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(corners);
    const mat = new THREE.LineBasicMaterial({
      color: 0x88aaff,
      depthTest: false,
      transparent: true,
      opacity: 0.8,
    });
    marqueeRectObj = new THREE.Line(geo, mat);
    marqueeRectObj.renderOrder = 1010;
    scene.add(marqueeRectObj);
    // Find shapes with any endpoint inside the marquee bounds
    const minX = Math.min(p1.x, p2.x),
      maxX = Math.max(p1.x, p2.x);
    const minY = Math.min(p1.y, p2.y),
      maxY = Math.max(p1.y, p2.y);
    const shapes = selItem.shapes || [];
    const inRect = new Set();
    getSnapPoints(shapes).forEach((pt) => {
      if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY)
        inRect.add(pt.shapeIdx);
    });
    multiSelectedIndices = [...inRect];
    showMultiSelectOverlays(multiSelectedIndices);
  };

  const clearSketchSelection = () => {
    clearSketchSelectionOverlay();
    useStore.getState().setSelectedSketchElement(null);
    clearMultiSelectOverlays();
    multiSelectedIndices = [];
  };

  // Whenever sketch shapes are mutated (any store items change while in sketch
  // mode), the selection overlay drawn at the old position becomes a ghost.
  // Clear it so the user sees the updated geometry without stale highlights.
  const unsubItems = useStore.subscribe(
    (state) => state.items,
    () => {
      if (!sketchModeRef.current) return;
      if (sketchSelectionOverlay) clearSketchSelectionOverlay();
      if (multiSelectOverlays.length > 0) {
        clearMultiSelectOverlays();
        multiSelectedIndices = [];
      }
      clearConstraintHoverHighlight();
      clearConstraintSelection();
    },
  );

  // BFS over coincident constraints to collect all shape indices reachable from startIdx
  const collectConnectedShapes = (startIdx, shapes, constraints) => {
    const visited = new Set([startIdx]);
    const queue = [startIdx];
    while (queue.length > 0) {
      const idx = queue.shift();
      for (const c of constraints) {
        if (c.type !== "coincident") continue;
        let other = -1;
        if (c.shapeAIdx === idx && !visited.has(c.shapeBIdx))
          other = c.shapeBIdx;
        else if (c.shapeBIdx === idx && !visited.has(c.shapeAIdx))
          other = c.shapeAIdx;
        if (other >= 0 && shapes[other]) {
          visited.add(other);
          queue.push(other);
        }
      }
    }
    return [...visited];
  };

  const trySelectSketchElement = (screenX, screenY) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    const shapes = selItem.shapes || [];
    // Point hit first
    const snap = findSnap(screenX, screenY, shapes, sketchMesh);
    if (snap) {
      sketchSelectPoint(snap, sketchMesh);
      if (dimHintRef.current) dimHintRef.current.style.display = "none";
      return;
    }
    // Line hit
    const sketchGroup = sketchShapesGroupRef?.current;
    if (sketchGroup) {
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
      const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
      const ray = new THREE.Raycaster();
      ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
      const lineObjs = sketchGroup.children.filter(
        (c) => c.userData.shapeIdx != null,
      );
      const hits = hitTestSketchLines(ray, lineObjs);
      if (hits.length > 0 && hits[0].object.userData.shapeIdx != null) {
        const shapeIdx = hits[0].object.userData.shapeIdx;
        const shape = shapes[shapeIdx];
        if (shape) {
          sketchSelectLine(shapeIdx, shape, sketchMesh);
          const len = getShapeLength(shape);
          if (len !== null && dimHintRef.current) {
            const rect2 = renderer.domElement.getBoundingClientRect();
            dimHintRef.current.textContent = `${len.toFixed(1)} mm`;
            dimHintRef.current.style.display = "block";
            dimHintRef.current.style.left = `${screenX - rect2.left + 16}px`;
            dimHintRef.current.style.top = `${screenY - rect2.top - 10}px`;
          }
          return;
        }
      }
    }
    // Region-fill click: select all boundary shapes that form the hovered area
    const localForFill = screenToSketchLocal(screenX, screenY, sketchMesh);
    const sketchGroup2 = sketchShapesGroupRef?.current;
    if (localForFill && sketchGroup2) {
      // Sort fills so higher renderOrder (inner fills) are checked first
      const fillMeshes = sketchGroup2.children
        .filter((c) => c.userData.isRegionFill)
        .sort((a, b) => (b.renderOrder ?? 0) - (a.renderOrder ?? 0));
      for (const fill of fillMeshes) {
        const inOuter = pointInPolygon2D(localForFill, fill.userData.polygon2D);
        const inHole = (fill.userData.holes2D || []).some((h) =>
          pointInPolygon2D(localForFill, h),
        );
        if (inOuter && !inHole) {
          const indices = fill.userData.shapeIndices || [];
          if (indices.length > 0) {
            multiSelectedIndices = indices;
            showMultiSelectOverlays(indices);
            clearSketchSelectionOverlay();
            useStore.getState().setSelectedSketchElement(null);
            if (dimHintRef.current) dimHintRef.current.style.display = "none";
            return;
          }
        }
      }
    }
    clearSketchSelection();
    if (dimHintRef.current) dimHintRef.current.style.display = "none";
  };

  const handleDistanceConstraintClick = (screenX, screenY) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    const shapes = selItem.shapes || [];
    const store = useStore.getState();
    const snap = findSnap(screenX, screenY, shapes, sketchMesh);

    if (!snap) {
      // No snap point nearby — try a line hit-test for a line-length constraint
      const sketchGroup = sketchShapesGroupRef?.current;
      if (!sketchGroup) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
      const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
      const ray = new THREE.Raycaster();
      ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
      const lineObjs = sketchGroup.children.filter(
        (c) => c.userData.shapeIdx != null,
      );
      const hits = hitTestSketchLines(ray, lineObjs);
      if (hits.length === 0 || hits[0].object.userData.shapeIdx == null) return;
      const lineIdx = hits[0].object.userData.shapeIdx;
      const shape = shapes[lineIdx];
      if (!shape) return;
      store.setSketchConstraintFirstPoint(null);
      clearCoincidentFirstOverlay();
      if (shape.type === "circle") {
        store.setSketchDistanceInput({
          shapeAIdx: lineIdx,
          pointA: "center",
          shapeBIdx: lineIdx,
          pointB: "edge",
          defaultDistance: shape.r,
        });
      } else if (shape.type === "line") {
        store.setSketchDistanceInput({
          shapeAIdx: lineIdx,
          pointA: "start",
          shapeBIdx: lineIdx,
          pointB: "end",
          defaultDistance: Math.hypot(shape.x2 - shape.x1, shape.y2 - shape.y1),
        });
      }
      return;
    }

    const firstPt = store.sketchConstraintFirstPoint;
    if (!firstPt) {
      store.setSketchConstraintFirstPoint({
        shapeIdx: snap.shapeIdx,
        pointKey: snap.pointKey,
      });
      clearCoincidentFirstOverlay();
      coincidentFirstOverlay = makeRingOverlay(
        { x: snap.x, y: snap.y },
        sketchMesh,
        0xff8800,
      );
      scene.add(coincidentFirstOverlay);
    } else {
      if (
        firstPt.shapeIdx === snap.shapeIdx &&
        firstPt.pointKey === snap.pointKey
      )
        return;
      const firstShape = shapes[firstPt.shapeIdx];
      const firstPos = firstShape
        ? getShapePoint(firstShape, firstPt.pointKey)
        : null;
      const secondPos = { x: snap.x, y: snap.y };
      if (firstPos) {
        const defaultDist = Math.hypot(
          secondPos.x - firstPos.x,
          secondPos.y - firstPos.y,
        );
        store.setSketchDistanceInput({
          shapeAIdx: firstPt.shapeIdx,
          pointA: firstPt.pointKey,
          shapeBIdx: snap.shapeIdx,
          pointB: snap.pointKey,
          defaultDistance: defaultDist,
        });
        clearCoincidentFirstOverlay();
        store.setSketchConstraintFirstPoint(null);
      }
    }
  };

  const handleCoincidentClick = (screenX, screenY) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    const shapes = selItem.shapes || [];
    const snap = findSnap(screenX, screenY, shapes, sketchMesh);
    const store = useStore.getState();
    const firstPt = store.sketchConstraintFirstPoint;

    if (!snap) {
      // No nearby point — if a first point is already selected, try a line-body hit
      // to create a point-on-line constraint.
      if (!firstPt) return;
      const sketchGroup = sketchShapesGroupRef?.current;
      if (!sketchGroup) return;
      const ray = makeRay(screenX, screenY);
      const lineObjs = sketchGroup.children.filter(
        (c) => c.userData.shapeIdx != null,
      );
      const hits = hitTestSketchLines(ray, lineObjs);
      if (hits.length === 0 || hits[0].object.userData.shapeIdx == null) return;
      const lineIdx = hits[0].object.userData.shapeIdx;
      const lineShape = shapes[lineIdx];
      if (!lineShape || lineShape.type !== "line") return;
      const ptShape = shapes[firstPt.shapeIdx];
      const ptPos = ptShape ? getShapePoint(ptShape, firstPt.pointKey) : null;
      if (!ptPos) return;
      // Project the point onto the line and commit
      const projected = projectOntoLine(ptPos, lineShape);
      const newPtShape = moveShapePoint(ptShape, firstPt.pointKey, projected);
      if (newPtShape) {
        const propagated = propagateConstraints(
          selectedIdRef.current,
          firstPt.shapeIdx,
          newPtShape,
          firstPt.pointKey,
        );
        if (propagated.size > 1)
          store.updateSketchShapes(selectedIdRef.current, propagated);
        else
          store.updateSketchShape(
            selectedIdRef.current,
            firstPt.shapeIdx,
            newPtShape,
          );
      }
      store.addSketchConstraints(selectedIdRef.current, [
        {
          type: "onLine",
          pointShapeIdx: firstPt.shapeIdx,
          pointKey: firstPt.pointKey,
          lineShapeIdx: lineIdx,
        },
      ]);
      store.setSketchConstraintMode(null);
      store.setSketchConstraintFirstPoint(null);
      clearCoincidentFirstOverlay();
      clearSketchSelection();
      return;
    }

    if (!firstPt) {
      store.setSketchConstraintFirstPoint({
        shapeIdx: snap.shapeIdx,
        pointKey: snap.pointKey,
      });
      clearCoincidentFirstOverlay();
      coincidentFirstOverlay = makeRingOverlay(
        { x: snap.x, y: snap.y },
        sketchMesh,
        0xff8800,
      );
      scene.add(coincidentFirstOverlay);
    } else {
      if (
        firstPt.shapeIdx === snap.shapeIdx &&
        firstPt.pointKey === snap.pointKey
      )
        return;
      const firstShape = shapes[firstPt.shapeIdx];
      const firstPos = firstShape
        ? getShapePoint(firstShape, firstPt.pointKey)
        : null;
      if (firstPos) {
        const secondShape = shapes[snap.shapeIdx];
        const newSecondShape = secondShape
          ? moveShapePoint(secondShape, snap.pointKey, firstPos)
          : null;
        let currentShapes = shapes; // shapes after propagation, for coincident scan
        if (newSecondShape) {
          const propagated = propagateConstraints(
            selectedIdRef.current,
            snap.shapeIdx,
            newSecondShape,
            snap.pointKey,
          );
          if (propagated.size > 1)
            store.updateSketchShapes(selectedIdRef.current, propagated);
          else
            store.updateSketchShape(
              selectedIdRef.current,
              snap.shapeIdx,
              newSecondShape,
            );
          // Build updated snapshot so we can detect which points landed at firstPos
          currentShapes = shapes.slice();
          propagated.forEach((s, i) => {
            currentShapes[i] = s;
          });
        }

        // Primary constraint: A → B
        const newConstraints = [
          {
            type: "coincident",
            shapeAIdx: firstPt.shapeIdx,
            pointA: firstPt.pointKey,
            shapeBIdx: snap.shapeIdx,
            pointB: snap.pointKey,
          },
        ];

        // Auto-link every other point that is now sitting at firstPos (including
        // those that arrived there because they were coincident with B and moved
        // during propagation). This ensures a multi-line junction gets all of its
        // constraints in one operation.
        const EPS_COINCI = 1e-3;
        const existingConstraints = selItem.constraints || [];
        getSnapPoints(currentShapes).forEach((sp) => {
          if (
            sp.shapeIdx === firstPt.shapeIdx &&
            sp.pointKey === firstPt.pointKey
          )
            return; // A itself
          if (sp.shapeIdx === snap.shapeIdx && sp.pointKey === snap.pointKey)
            return; // B (already primary)
          const spPos = getShapePoint(currentShapes[sp.shapeIdx], sp.pointKey);
          if (!spPos) return;
          if (
            Math.hypot(spPos.x - firstPos.x, spPos.y - firstPos.y) > EPS_COINCI
          )
            return;
          // Already linked to A?
          const linked =
            existingConstraints.some(
              (c) =>
                c.type === "coincident" &&
                ((c.shapeAIdx === firstPt.shapeIdx &&
                  c.pointA === firstPt.pointKey &&
                  c.shapeBIdx === sp.shapeIdx &&
                  c.pointB === sp.pointKey) ||
                  (c.shapeBIdx === firstPt.shapeIdx &&
                    c.pointB === firstPt.pointKey &&
                    c.shapeAIdx === sp.shapeIdx &&
                    c.pointA === sp.pointKey)),
            ) ||
            newConstraints.some(
              (c) =>
                c.shapeAIdx === firstPt.shapeIdx &&
                c.pointA === firstPt.pointKey &&
                c.shapeBIdx === sp.shapeIdx &&
                c.pointB === sp.pointKey,
            );
          if (!linked) {
            newConstraints.push({
              type: "coincident",
              shapeAIdx: firstPt.shapeIdx,
              pointA: firstPt.pointKey,
              shapeBIdx: sp.shapeIdx,
              pointB: sp.pointKey,
            });
          }
        });

        store.addSketchConstraints(selectedIdRef.current, newConstraints);
      }
      store.setSketchConstraintMode(null);
      store.setSketchConstraintFirstPoint(null);
      clearCoincidentFirstOverlay();
      clearSketchSelection();
    }
  };

  // ── Chamfer / Bevel ──────────────────────────────────────────────────────
  const MODIFY_DIST = 0.25;

  let modifyPreviewObjs = [];
  const clearModifyPreview = () => {
    modifyPreviewObjs.forEach((o) => {
      scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    modifyPreviewObjs = [];
  };

  const findJunction = (snap, shapes, constraints) => {
    for (const c of constraints) {
      if (c.type !== "coincident") continue;
      let aIdx, aKey, bIdx, bKey;
      if (c.shapeAIdx === snap.shapeIdx && c.pointA === snap.pointKey) {
        aIdx = c.shapeAIdx;
        aKey = c.pointA;
        bIdx = c.shapeBIdx;
        bKey = c.pointB;
      } else if (c.shapeBIdx === snap.shapeIdx && c.pointB === snap.pointKey) {
        aIdx = c.shapeBIdx;
        aKey = c.pointB;
        bIdx = c.shapeAIdx;
        bKey = c.pointA;
      } else continue;
      if (shapes[aIdx]?.type === "line" && shapes[bIdx]?.type === "line")
        return { aIdx, aKey, bIdx, bKey, constraint: c };
    }
    return null;
  };

  const lineEndpoint = (shape, key) =>
    key === "start"
      ? { x: shape.x1, y: shape.y1 }
      : { x: shape.x2, y: shape.y2 };

  const computeModify = (shapes, junc, dist) => {
    const { aIdx, aKey, bIdx, bKey } = junc;
    const sA = shapes[aIdx],
      sB = shapes[bIdx];
    const P = lineEndpoint(sA, aKey);
    const otherA =
      aKey === "start" ? { x: sA.x2, y: sA.y2 } : { x: sA.x1, y: sA.y1 };
    const otherB =
      bKey === "start" ? { x: sB.x2, y: sB.y2 } : { x: sB.x1, y: sB.y1 };
    const uA = norm2({ x: otherA.x - P.x, y: otherA.y - P.y });
    const uB = norm2({ x: otherB.x - P.x, y: otherB.y - P.y });
    const trimA = { x: P.x + uA.x * dist, y: P.y + uA.y * dist };
    const trimB = { x: P.x + uB.x * dist, y: P.y + uB.y * dist };
    return { P, uA, uB, trimA, trimB, sA, sB, aIdx, aKey, bIdx, bKey };
  };

  const applyModify = (screenX, screenY, mode) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    const shapes = selItem.shapes || [];
    const constraints = selItem.constraints || [];
    const snap = findSnap(screenX, screenY, shapes, sketchMesh);
    if (!snap) return;
    const junc = findJunction(snap, shapes, constraints);
    if (!junc) return;
    const m = computeModify(shapes, junc, MODIFY_DIST);
    const newSA = moveShapePoint(m.sA, m.aKey, m.trimA);
    const newSB = moveShapePoint(m.sB, m.bKey, m.trimB);
    if (!newSA || !newSB) return;
    // Propagate constraints from each trimmed line so anything attached to their
    // far ends follows the trim.
    const propA = propagateConstraints(
      selectedIdRef.current,
      m.aIdx,
      newSA,
      m.aKey,
    );
    const propB = propagateConstraints(
      selectedIdRef.current,
      m.bIdx,
      newSB,
      m.bKey,
    );
    const updates = new Map([...propA, ...propB]);
    let newElement;
    if (mode === "chamfer") {
      newElement = {
        type: "line",
        x1: m.trimA.x,
        y1: m.trimA.y,
        x2: m.trimB.x,
        y2: m.trimB.y,
      };
    } else {
      newElement = buildBevelArc(m.P, m.uA, m.uB, m.trimA, m.trimB);
      if (!newElement) {
        newElement = {
          type: "line",
          x1: m.trimA.x,
          y1: m.trimA.y,
          x2: m.trimB.x,
          y2: m.trimB.y,
        };
      } else {
        newElement.kind = "bevel";
        newElement.bevelData = {
          aIdx: m.aIdx,
          aKey: m.aKey,
          bIdx: m.bIdx,
          bKey: m.bKey,
          dist: MODIFY_DIST,
        };
      }
    }
    const newIdx = shapes.length;
    const newConstraints = [
      {
        type: "coincident",
        shapeAIdx: newIdx,
        pointA: "start",
        shapeBIdx: m.aIdx,
        pointB: m.aKey,
      },
      {
        type: "coincident",
        shapeAIdx: newIdx,
        pointA: "end",
        shapeBIdx: m.bIdx,
        pointB: m.bKey,
      },
    ];
    const juncConstraint = junc.constraint;
    useStore
      .getState()
      .applySketchModify(
        selectedIdRef.current,
        updates,
        newElement,
        (c) => c === juncConstraint,
        newConstraints,
      );
    clearModifyPreview();
  };

  const showModifyPreview = (screenX, screenY, mode) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) {
      clearModifyPreview();
      return;
    }
    const shapes = selItem.shapes || [];
    const constraints = selItem.constraints || [];
    const snap = findSnap(screenX, screenY, shapes, sketchMesh);
    if (!snap) {
      clearModifyPreview();
      renderer.domElement.style.cursor = "";
      return;
    }
    const junc = findJunction(snap, shapes, constraints);
    if (!junc) {
      clearModifyPreview();
      renderer.domElement.style.cursor = "crosshair";
      return;
    }
    clearModifyPreview();
    renderer.domElement.style.cursor = "pointer";
    const m = computeModify(shapes, junc, MODIFY_DIST);
    const toW = (lx, ly) => {
      const v = new THREE.Vector3(lx, ly, 0.006);
      v.applyQuaternion(sketchMesh.quaternion);
      v.add(sketchMesh.position);
      return v;
    };
    const previewMat = new THREE.LineBasicMaterial({
      color: 0xffcc44,
      depthTest: false,
    });
    const addPreview = (pts) => {
      const l = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        previewMat,
      );
      l.renderOrder = 1008;
      scene.add(l);
      modifyPreviewObjs.push(l);
    };
    // Trimmed line A
    const newSA = moveShapePoint(m.sA, m.aKey, m.trimA);
    if (newSA) {
      const pts = getSketchShapePoints(newSA, sketchMesh);
      if (pts.length >= 2) addPreview(pts);
    }
    // Trimmed line B
    const newSB = moveShapePoint(m.sB, m.bKey, m.trimB);
    if (newSB) {
      const pts = getSketchShapePoints(newSB, sketchMesh);
      if (pts.length >= 2) addPreview(pts);
    }
    // New element
    if (mode === "chamfer") {
      addPreview([toW(m.trimA.x, m.trimA.y), toW(m.trimB.x, m.trimB.y)]);
    } else {
      const arc = buildBevelArc(m.P, m.uA, m.uB, m.trimA, m.trimB);
      if (arc) {
        const pts = getSketchShapePoints(arc, sketchMesh);
        if (pts.length >= 2) addPreview(pts);
      }
    }
  };

  // ── Extrude profile selection ─────────────────────────────────────────────

  let extrudePreviewMesh = null;
  let extrudeProfileData = null;
  let extrudeDepthOriginV3 = null;
  let extrudeNormalV3 = null;

  const clearExtrudePreview = () => {
    if (extrudePreviewMesh) {
      scene.remove(extrudePreviewMesh);
      extrudePreviewMesh.geometry.dispose();
      extrudePreviewMesh.material.dispose();
      extrudePreviewMesh = null;
    }
  };

  const buildExtrudePreviewMesh = (profile, depth) => {
    clearExtrudePreview();
    const poly = profile.polygon2D;
    if (!poly || poly.length < 3) return;
    const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(0.05, depth),
      bevelEnabled: false,
    });
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide,
      depthTest: true,
    });
    extrudePreviewMesh = new THREE.Mesh(geo, mat);
    const rot = profile.rotation;
    extrudePreviewMesh.rotation.set(rot.x, rot.y, rot.z);
    const pos = profile.position;
    extrudePreviewMesh.position.set(pos.x, pos.y, pos.z);
    extrudePreviewMesh.renderOrder = 10;
    scene.add(extrudePreviewMesh);
  };

  const makeRay = (screenX, screenY) => {
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    return ray;
  };

  const convexHull2D = (points) => {
    if (points.length <= 3) return points;
    let lo = 0;
    for (let i = 1; i < points.length; i++)
      if (points[i].x < points[lo].x) lo = i;
    const hull = [];
    let p = lo,
      safety = 0;
    do {
      hull.push(points[p]);
      let q = (p + 1) % points.length;
      for (let i = 0; i < points.length; i++) {
        const cross =
          (points[q].x - points[p].x) * (points[i].y - points[p].y) -
          (points[q].y - points[p].y) * (points[i].x - points[p].x);
        if (cross > 0) q = i;
      }
      p = q;
    } while (p !== lo && ++safety <= points.length + 2);
    return hull;
  };

  const extractFaceProfile = (hit) => {
    const hitMesh = hit.object;
    const localNormal = hit.face.normal.clone();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(
      hitMesh.matrixWorld,
    );
    const worldNormal = localNormal
      .clone()
      .applyMatrix3(normalMatrix)
      .normalize();

    const posAttr = hitMesh.geometry.getAttribute("position");
    const idxAttr = hitMesh.geometry.index;
    const triCount = idxAttr ? idxAttr.count / 3 : posAttr.count / 3;
    const vA = new THREE.Vector3(),
      vB = new THREE.Vector3(),
      vC = new THREE.Vector3();
    const seen = new Map();
    for (let i = 0; i < triCount; i++) {
      let a, b, c;
      if (idxAttr) {
        a = idxAttr.getX(i * 3);
        b = idxAttr.getX(i * 3 + 1);
        c = idxAttr.getX(i * 3 + 2);
      } else {
        a = i * 3;
        b = i * 3 + 1;
        c = i * 3 + 2;
      }
      vA.set(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a));
      vB.set(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b));
      vC.set(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c));
      const triNorm = new THREE.Vector3()
        .crossVectors(
          new THREE.Vector3().subVectors(vB, vA),
          new THREE.Vector3().subVectors(vC, vA),
        )
        .normalize();
      if (triNorm.dot(localNormal) < 0.99) continue;
      for (const v of [vA, vB, vC]) {
        const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
        if (!seen.has(key))
          seen.set(key, v.clone().applyMatrix4(hitMesh.matrixWorld));
      }
    }
    if (seen.size < 3) return null;

    // Build face-local 2D coordinate system consistent with the rotation quaternion
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      worldNormal,
    );
    const euler = new THREE.Euler().setFromQuaternion(q);
    const xLocal = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const yLocal = new THREE.Vector3(0, 1, 0).applyQuaternion(q);

    const origin = hit.point.clone();
    const verts2D = [...seen.values()].map((v) => {
      const rel = v.clone().sub(origin);
      return { x: rel.dot(xLocal), y: rel.dot(yLocal) };
    });
    const polygon2D = convexHull2D(verts2D);
    if (polygon2D.length < 3) return null;

    return {
      type: "face",
      polygon2D,
      position: { x: origin.x, y: origin.y, z: origin.z },
      rotation: { x: euler.x, y: euler.y, z: euler.z },
      normalWorld: { x: worldNormal.x, y: worldNormal.y, z: worldNormal.z },
    };
  };

  const computeExtrudeDepth = (screenX, screenY) => {
    if (!extrudeDepthOriginV3 || !extrudeNormalV3) return 1.0;
    const ray = makeRay(screenX, screenY);
    const camDir = new THREE.Vector3();
    cameraRef.current.getWorldDirection(camDir);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      camDir,
      extrudeDepthOriginV3,
    );
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return 1.0;
    const depth = hit.sub(extrudeDepthOriginV3).dot(extrudeNormalV3);
    return Math.max(0.05, depth);
  };

  const handleExtrudeHover = (screenX, screenY) => {
    const fills =
      extrudeSelectGroupRef && extrudeSelectGroupRef.current
        ? extrudeSelectGroupRef.current.children
        : [];
    fills.forEach((m) => {
      m.material.opacity = 0;
    });
    const ray = makeRay(screenX, screenY);
    // Check sketch fills first
    if (fills.length > 0) {
      const hits = ray.intersectObjects(fills, false);
      if (hits.length > 0) {
        hits[0].object.material.opacity = 0.3;
        renderer.domElement.style.cursor = "pointer";
        clearFaceHighlight();
        return;
      }
    }
    // Check solid object faces
    const solids = Object.values(objectsRef.current).filter((m) => {
      if (!m.visible) return false;
      const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
      return it && it.type !== "sketch" && it.type !== "extrude";
    });
    const solidHits = ray.intersectObjects(solids, false);
    if (solidHits.length > 0) {
      applyFaceHighlight(solidHits[0], 0x4488ff);
      renderer.domElement.style.cursor = "pointer";
      return;
    }
    clearFaceHighlight();
    renderer.domElement.style.cursor = "crosshair";
  };

  const handleExtrudeProfileClick = (screenX, screenY) => {
    const fills = extrudeSelectGroupRef?.current?.children ?? [];
    if (fills.length > 0) {
      // Use 2D point-in-polygon detection instead of 3D raycasting so that the most
      // specific (smallest-area) region is always selected even when multiple fill meshes
      // are coplanar and raycasting would return an arbitrary first hit.
      let bestFill = null;
      let bestArea = Infinity;
      let bestLocalPt = null;
      for (const fill of fills) {
        const profile = fill.userData.extrudeProfile;
        if (!profile) continue;
        const sketchMesh = objectsRef.current[profile.sketchId];
        if (!sketchMesh) continue;
        const localPt = screenToSketchLocal(screenX, screenY, sketchMesh);
        if (!localPt) continue;
        const inOuter = pointInPolygon2D(localPt, profile.polygon2D);
        const inHole = (profile.holes || []).some((h) =>
          pointInPolygon2D(localPt, h),
        );
        if (inOuter && !inHole) {
          const area = polyArea(profile.polygon2D);
          if (area < bestArea) {
            bestFill = fill;
            bestArea = area;
            bestLocalPt = localPt;
          }
        }
      }
      if (bestFill) {
        const profile = bestFill.userData.extrudeProfile;
        // Use the actual click position as profileCentroid rather than the
        // pre-computed polyCentroid(polygon).  polyCentroid is the arithmetic
        // mean of polygon vertices, which is biased toward densely-sampled arc
        // boundaries and can fall inside a neighbouring smaller region.  The
        // click point is guaranteed to be inside the correct polygon (we just
        // verified inOuter && !inHole above), so it is a reliable anchor for
        // profile re-matching in buildSceneObjects.
        extrudeProfileData = { ...profile, profileCentroid: bestLocalPt };
        extrudeDepthOriginV3 = new THREE.Vector3(
          profile.position.x,
          profile.position.y,
          profile.position.z,
        );
        extrudeNormalV3 = new THREE.Vector3(
          profile.normalWorld.x,
          profile.normalWorld.y,
          profile.normalWorld.z,
        );
        const retargetItem = itemsRef.current.find(
          (i) => i.id === useStore.getState().extrudeRetargetId,
        );
        buildExtrudePreviewMesh(profile, retargetItem?.depth ?? 1.0);
        useStore.getState().setExtrudeSelectMode("depth");
        renderer.domElement.style.cursor = "ns-resize";
        return;
      }
    }
    const solids = Object.values(objectsRef.current).filter((m) => {
      if (!m.visible) return false;
      const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
      return it && it.type !== "sketch" && it.type !== "extrude";
    });
    const solidHits = ray.intersectObjects(solids, false);
    if (solidHits.length > 0) {
      const profile = extractFaceProfile(solidHits[0]);
      if (profile) {
        extrudeProfileData = profile;
        extrudeDepthOriginV3 = new THREE.Vector3(
          profile.position.x,
          profile.position.y,
          profile.position.z,
        );
        extrudeNormalV3 = new THREE.Vector3(
          profile.normalWorld.x,
          profile.normalWorld.y,
          profile.normalWorld.z,
        );
        const retargetItem = itemsRef.current.find(
          (i) => i.id === useStore.getState().extrudeRetargetId,
        );
        buildExtrudePreviewMesh(profile, retargetItem?.depth ?? 1.0);
        useStore.getState().setExtrudeSelectMode("depth");
        renderer.domElement.style.cursor = "ns-resize";
      }
    }
  };

  const handleExtrudeDepthMove = (screenX, screenY) => {
    const depth = computeExtrudeDepth(screenX, screenY);
    if (extrudeProfileData) buildExtrudePreviewMesh(extrudeProfileData, depth);
  };

  const finalizeExtrude = (screenX, screenY) => {
    if (!extrudeProfileData) return;
    const depth = Math.max(0.05, computeExtrudeDepth(screenX, screenY));
    clearExtrudePreview();
    const store = useStore.getState();
    const retargetId = store.extrudeRetargetId;
    if (retargetId != null) {
      store.retargetExtrude(retargetId, extrudeProfileData, depth);
      store.setExtrudeRetargetId(null);
    } else {
      let maxId = 0;
      store.history.forEach((e) => {
        if (
          e.instruction &&
          e.instruction.type === "create" &&
          e.instruction.item.id > maxId
        )
          maxId = e.instruction.item.id;
      });
      store.addItem({
        id: maxId + 1,
        name: `Extrude ${maxId + 1}`,
        type: "extrude",
        children: [],
        profile: extrudeProfileData,
        depth,
        position: extrudeProfileData.position,
        rotation: extrudeProfileData.rotation,
        scale: { x: 1, y: 1, z: 1 },
      });
    }
    extrudeProfileData = null;
    extrudeDepthOriginV3 = null;
    extrudeNormalV3 = null;
    store.setExtrudeSelectMode(null);
    renderer.domElement.style.cursor = "";
  };

  const cancelExtrude = () => {
    clearExtrudePreview();
    extrudeProfileData = null;
    extrudeDepthOriginV3 = null;
    extrudeNormalV3 = null;
    const fills =
      extrudeSelectGroupRef && extrudeSelectGroupRef.current
        ? extrudeSelectGroupRef.current.children
        : [];
    fills.forEach((m) => {
      m.material.opacity = 0;
    });
    clearFaceHighlight();
    renderer.domElement.style.cursor = "";
    const store = useStore.getState();
    store.setExtrudeSelectMode(null);
    store.setExtrudeRetargetId(null);
  };

  const trySelectSketchLine = (screenX, screenY) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchGroup = sketchShapesGroupRef?.current;
    if (!selItem || !sketchGroup) {
      if (dimHintRef.current) dimHintRef.current.style.display = "none";
      return;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
    const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
    const ray = new THREE.Raycaster();
    ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
    const lineObjs = sketchGroup.children.filter(
      (c) => c.userData.shapeIdx != null,
    );
    const hits = ray.intersectObjects(lineObjs, false);
    if (hits.length > 0 && hits[0].object.userData.shapeIdx != null) {
      const shape = selItem.shapes?.[hits[0].object.userData.shapeIdx];
      if (shape) {
        const len = getShapeLength(shape);
        if (len !== null && dimHintRef.current) {
          dimHintRef.current.textContent = `${len.toFixed(1)} mm`;
          dimHintRef.current.style.display = "block";
          dimHintRef.current.style.left = `${screenX - rect.left + 16}px`;
          dimHintRef.current.style.top = `${screenY - rect.top - 10}px`;
        }
      }
    } else {
      if (dimHintRef.current) dimHintRef.current.style.display = "none";
    }
  };

  // ── Sketch element dragging ───────────────────────────────────────────────
  let sketchDrag = null; // { kind:"point"|"shape", shapeIdx, pointKey?, sketchMesh, selItemId, anchorLocal, origShape }

  let currentDragIndicator = null;
  const clearDragIndicator = () => {
    if (currentDragIndicator) {
      scene.remove(currentDragIndicator);
      currentDragIndicator.geometry.dispose();
      currentDragIndicator.material.dispose();
      currentDragIndicator = null;
    }
  };
  const showDragIndicator = (localPt, sketchMesh) => {
    clearDragIndicator();
    const R = 0.18;
    const toW = (x, y) => {
      const v = new THREE.Vector3(x, y, 0.008);
      v.applyQuaternion(sketchMesh.quaternion);
      v.add(sketchMesh.position);
      return v;
    };
    const circlePts = Array.from({ length: 17 }, (_, i) => {
      const a = (i / 16) * Math.PI * 2;
      return toW(localPt.x + Math.cos(a) * R, localPt.y + Math.sin(a) * R);
    });
    const mat = new THREE.LineBasicMaterial({
      color: 0x00ffcc,
      depthTest: false,
    });
    currentDragIndicator = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(circlePts),
      mat,
    );
    currentDragIndicator.renderOrder = 1006;
    scene.add(currentDragIndicator);
  };

  const updateSketchLineGeo = (lineObj, newShape, sketchMesh) => {
    const pts = getSketchShapePoints(newShape, sketchMesh);
    if (pts.length < 2) return;
    lineObj.geometry.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    lineObj.computeLineDistances();
  };

  const translateShape = (shape, dx, dy) => {
    switch (shape.type) {
      case "line":
        return {
          ...shape,
          x1: shape.x1 + dx,
          y1: shape.y1 + dy,
          x2: shape.x2 + dx,
          y2: shape.y2 + dy,
        };
      case "rect":
        return {
          ...shape,
          x1: shape.x1 + dx,
          y1: shape.y1 + dy,
          x2: shape.x2 + dx,
          y2: shape.y2 + dy,
        };
      case "circle":
        return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
      case "ellipse":
        return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
      case "arc":
        return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
      case "bezier":
        return {
          ...shape,
          p0: { x: shape.p0.x + dx, y: shape.p0.y + dy },
          p1: { x: shape.p1.x + dx, y: shape.p1.y + dy },
          p2: { x: shape.p2.x + dx, y: shape.p2.y + dy },
          p3: { x: shape.p3.x + dx, y: shape.p3.y + dy },
        };
      default:
        return null;
    }
  };

  // Wrapper: reads shapes/constraints from store, delegates to enforceConstraints.
  const propagateConstraints = (
    selItemId,
    primaryIdx,
    primaryShape,
    primaryPointKey = null,
    preSeeded = null,
  ) => {
    const selItem = itemsRef.current.find((i) => i.id === selItemId);
    if (!selItem) return new Map([[primaryIdx, primaryShape]]);
    return enforceConstraints(
      selItem.shapes || [],
      selItem.constraints || [],
      primaryIdx,
      primaryShape,
      primaryPointKey,
      preSeeded,
    );
  };

  // Expose propagateConstraints so Viewport can enforce constraints immediately
  // after adding or editing them (outside a drag operation).
  if (propagateConstraintsRef)
    propagateConstraintsRef.current = propagateConstraints;

  const applySketchDragMove = (screenX, screenY, shiftKey) => {
    if (!sketchDrag) return;
    const { kind, sketchMesh, selItemId, anchorLocal } = sketchDrag;
    const selItem = itemsRef.current.find((i) => i.id === selItemId);
    if (!selItem) return;

    let localPt = screenToSketchLocal(screenX, screenY, sketchMesh);
    if (!localPt) return;

    // ── Multi-shape drag ───────────────────────────────────────────────────
    if (kind === "multi") {
      const { multiIndices, multiOrigShapes } = sketchDrag;
      const dx = localPt.x - anchorLocal.x;
      const dy = localPt.y - anchorLocal.y;
      const pendingShapes = new Map();
      multiIndices.forEach((idx, i) => {
        const moved = translateShape(multiOrigShapes[i], dx, dy);
        if (moved) pendingShapes.set(idx, moved);
      });
      sketchDrag.pendingShapes = pendingShapes;
      // Propagate constraints from all moving shapes to adjacent shapes,
      // using the same propagateConstraints path as single-shape drag.
      let multiPrimIdx = multiIndices[0];
      let multiPrimShape = pendingShapes.get(multiPrimIdx);
      if (!multiPrimShape) {
        for (const [i, s] of pendingShapes) {
          multiPrimIdx = i;
          multiPrimShape = s;
          break;
        }
      }
      let allMoved = pendingShapes;
      if (multiPrimShape) {
        allMoved = propagateConstraints(
          selItemId,
          multiPrimIdx,
          multiPrimShape,
          null,
          new Map(pendingShapes),
        );
      }
      sketchDrag.multiPropagated = allMoved;
      const sketchGroup = sketchShapesGroupRef?.current;
      if (sketchGroup) {
        allMoved.forEach((shape, idx) => {
          const lineObj = sketchGroup.children.find(
            (c) => c.userData.shapeIdx === idx && c.geometry?.setPositions,
          );
          if (lineObj) updateSketchLineGeo(lineObj, shape, sketchMesh);
        });
        const tempShapes = (selItem.shapes || []).slice();
        allMoved.forEach((s, i) => {
          tempShapes[i] = s;
        });
        rebuildConstraintIconsForDrag(
          sketchGroup,
          selItem.constraints || [],
          tempShapes,
          sketchMesh,
          renderer,
          useStore.getState().dimensionsVisible,
        );
        rebuildPointDotsForDrag(sketchGroup, tempShapes, sketchMesh);
        selectedConstraintLineRefs = [];
        applyConstraintSelectionVisual();
      }
      clearHoverFills();
      return;
    }

    const { shapeIdx, pointKey, origShape } = sketchDrag;
    if (!shiftKey) {
      const others = selItem.shapes.filter((_, i) => i !== shapeIdx);
      const snap = findSnap(screenX, screenY, others, sketchMesh);
      if (snap) localPt = { x: snap.x, y: snap.y };
    }

    let newShape;
    let draggedPointKey = null;
    let preSeeded = null;
    if (kind === "point") {
      draggedPointKey = pointKey;
      newShape = moveShapePoint(origShape, pointKey, localPt);
      if (newShape) {
        newShape = applyHVEnforcement(
          newShape,
          pointKey,
          selItem.constraints || [],
          shapeIdx,
        );
        showDragIndicator(localPt, sketchMesh);
      }
    } else {
      const dx = localPt.x - anchorLocal.x;
      const dy = localPt.y - anchorLocal.y;
      newShape = translateShape(origShape, dx, dy);
      if (newShape) {
        const constraints = selItem.constraints || [];
        const shapes = selItem.shapes;

        // Shapes that must translate rigidly: the dragged shape, plus any
        // coincident-connected shape that has a distance constraint (can't
        // resize, so it must move as a unit). Propagates transitively.
        const hasDistConst = (idx) =>
          constraints.some(
            (c) =>
              c.type === "distance" &&
              (c.shapeAIdx === idx || c.shapeBIdx === idx),
          );
        const rigidSet = new Set([shapeIdx]);
        const rigidQueue = [shapeIdx];
        while (rigidQueue.length > 0) {
          const cur = rigidQueue.shift();
          for (const c of constraints) {
            if (c.type !== "coincident") continue;
            let other = null;
            if (c.shapeAIdx === cur && !rigidSet.has(c.shapeBIdx))
              other = c.shapeBIdx;
            else if (c.shapeBIdx === cur && !rigidSet.has(c.shapeAIdx))
              other = c.shapeAIdx;
            if (other !== null && hasDistConst(other)) {
              rigidSet.add(other);
              rigidQueue.push(other);
            }
          }
        }

        // Pre-translate all rigid shapes; propagateConstraints will use these
        // as fixed starting state and handle all further constraint propagation.
        preSeeded = new Map();
        for (const idx of rigidSet) {
          const moved =
            idx === shapeIdx ? newShape : translateShape(shapes[idx], dx, dy);
          if (moved) preSeeded.set(idx, moved);
        }
      }
    }
    if (!newShape) return;

    const propagated = propagateConstraints(
      selItemId,
      shapeIdx,
      newShape,
      draggedPointKey,
      preSeeded,
    );
    sketchDrag.pendingShape = newShape;
    sketchDrag.propagatedShapes = propagated;

    const sketchGroup = sketchShapesGroupRef?.current;
    if (sketchGroup) {
      propagated.forEach((constrainedShape, idx) => {
        const lineObj = sketchGroup.children.find(
          (c) => c.userData.shapeIdx === idx && c.geometry?.setPositions,
        );
        if (lineObj) updateSketchLineGeo(lineObj, constrainedShape, sketchMesh);
      });
      const tempShapes = (selItem.shapes || []).slice();
      propagated.forEach((s, i) => {
        tempShapes[i] = s;
      });
      rebuildConstraintIconsForDrag(
        sketchGroup,
        selItem.constraints || [],
        tempShapes,
        sketchMesh,
        renderer,
      );
      rebuildPointDotsForDrag(sketchGroup, tempShapes, sketchMesh);
    }
    clearHoverFills();
  };

  const commitSketchDrag = () => {
    const store = useStore.getState();
    if (sketchDrag?.kind === "multi") {
      const toSave = sketchDrag.multiPropagated ?? sketchDrag.pendingShapes;
      if (toSave?.size > 0) {
        store.updateSketchShapes(sketchDrag.selItemId, toSave);
      }
      clearSketchSelectionOverlay();
      clearCoincidentFirstOverlay();
      return;
    }
    if (!sketchDrag?.pendingShape) return;
    const { selItemId, shapeIdx, pendingShape, propagatedShapes } = sketchDrag;
    if (propagatedShapes && propagatedShapes.size > 0) {
      store.updateSketchShapes(selItemId, propagatedShapes);
    } else {
      store.updateSketchShape(selItemId, shapeIdx, pendingShape);
    }
    clearSketchSelectionOverlay();
    clearCoincidentFirstOverlay();
  };

  const startSketchDrag = (screenX, screenY, shiftKey) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return false;
    const shapes = selItem.shapes || [];
    clearAllSketchHover();

    // Point drag — check snap points first (higher priority, smaller target).
    if (!shiftKey) {
      const snap = findSnap(screenX, screenY, shapes, sketchMesh);
      if (snap) {
        // If the snapped shape is part of a multi-selection, drag them all together
        // (the snap point acts as the anchor instead of a single-point drag).
        if (
          multiSelectedIndices.length > 1 &&
          multiSelectedIndices.includes(snap.shapeIdx)
        ) {
          sketchDrag = {
            kind: "multi",
            sketchMesh,
            selItemId: selItem.id,
            anchorLocal: { x: snap.x, y: snap.y },
            multiIndices: [...multiSelectedIndices],
            multiOrigShapes: multiSelectedIndices.map((i) => shapes[i]),
          };
        } else {
          clearMultiSelectOverlays();
          multiSelectedIndices = [];
          sketchDrag = {
            kind: "point",
            shapeIdx: snap.shapeIdx,
            pointKey: snap.pointKey,
            sketchMesh,
            selItemId: selItem.id,
            anchorLocal: { x: snap.x, y: snap.y },
            origShape: shapes[snap.shapeIdx],
          };
        }
        renderer.domElement.style.cursor = "grabbing";
        return true;
      }
    }

    // Shape drag — hit-test Line2 objects
    const sketchGroup = sketchShapesGroupRef?.current;
    if (sketchGroup) {
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
      const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
      const ray = new THREE.Raycaster();
      ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
      const lineObjs = sketchGroup.children.filter(
        (c) => c.userData.shapeIdx != null,
      );
      const hits = hitTestSketchLines(ray, lineObjs);
      if (hits.length > 0 && hits[0].object.userData.shapeIdx != null) {
        const shapeIdx = hits[0].object.userData.shapeIdx;
        const localAnchor = screenToSketchLocal(
          screenX,
          screenY,
          sketchMesh,
        ) || { x: 0, y: 0 };
        // If the hit shape is part of a multi-selection, drag them all together
        if (
          multiSelectedIndices.length > 1 &&
          multiSelectedIndices.includes(shapeIdx)
        ) {
          sketchDrag = {
            kind: "multi",
            sketchMesh,
            selItemId: selItem.id,
            anchorLocal: localAnchor,
            multiIndices: [...multiSelectedIndices],
            multiOrigShapes: multiSelectedIndices.map((i) => shapes[i]),
          };
        } else {
          clearMultiSelectOverlays();
          multiSelectedIndices = [];
          sketchDrag = {
            kind: "shape",
            shapeIdx,
            sketchMesh,
            selItemId: selItem.id,
            anchorLocal: localAnchor,
            origShape: shapes[shapeIdx],
          };
        }
        renderer.domElement.style.cursor = "grabbing";
        return true;
      }
    }
    clearMultiSelectOverlays();
    multiSelectedIndices = [];
    return false;
  };

  const updateSketchPreview = (screenX, screenY, shiftKey = false) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!sketchMesh) return;

    // Show snap indicator even before first click
    const rawCur = screenToSketchLocal(screenX, screenY, sketchMesh);
    if (!shiftKey && rawCur) {
      const shapes = selItem?.shapes || [];
      const snap = findSnap(screenX, screenY, shapes, sketchMesh);
      if (snap) showSnapIndicator(snap, sketchMesh);
      else clearSnapIndicator();
    } else {
      clearSnapIndicator();
    }

    const draw = sketchDrawRef.current;
    if (!draw) return;
    const cur = rawCur;
    if (!cur) return;

    // Resolve snapped cursor position
    let effectiveCur = cur;
    let activeSnap = null;
    if (!shiftKey) {
      const shapes = selItem?.shapes || [];
      const snap = findSnap(screenX, screenY, shapes, sketchMesh);
      if (snap) {
        effectiveCur = { x: snap.x, y: snap.y };
        activeSnap = snap;
      }
    }
    draw.currentSnap = activeSnap;

    clearSketchPreview();
    clearHoverFills();

    if (draw.tool === "bezier") {
      const allPts = [...draw.points, effectiveCur];
      const toWorld = (p) => {
        const v = new THREE.Vector3(p.x, p.y, 0.003);
        v.applyQuaternion(sketchMesh.quaternion);
        v.add(sketchMesh.position);
        return v;
      };
      // Control polygon
      const ctrlWorldPts = allPts.map(toWorld);
      const ctrlLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(ctrlWorldPts),
        new THREE.LineBasicMaterial({
          color: 0x556677,
          transparent: true,
          opacity: 0.4,
          depthTest: false,
        }),
      );
      ctrlLine.renderOrder = 1001;
      scene.add(ctrlLine);
      draw.previewObjects.push(ctrlLine);
      // Bezier curve preview once we have all 4 points
      if (allPts.length >= 4) {
        const [q0, q1, q2, q3] = allPts;
        const curve = new THREE.CubicBezierCurve(
          new THREE.Vector2(q0.x, q0.y),
          new THREE.Vector2(q1.x, q1.y),
          new THREE.Vector2(q2.x, q2.y),
          new THREE.Vector2(q3.x, q3.y),
        );
        const curvePts = curve
          .getPoints(48)
          .map(({ x, y }) => toWorld({ x, y }));
        const curveLine = makePreviewLine2(curvePts);
        if (curveLine) {
          scene.add(curveLine);
          draw.previewObjects.push(curveLine);
        }
      }
      if (dimHintRef.current) {
        const rect = renderer.domElement.getBoundingClientRect();
        const labels = ["Start", "Control 1", "Control 2", "End"];
        dimHintRef.current.textContent =
          labels[Math.min(draw.points.length, 3)];
        dimHintRef.current.style.display = "block";
        dimHintRef.current.style.left = `${screenX - rect.left + 16}px`;
        dimHintRef.current.style.top = `${screenY - rect.top - 10}px`;
      }
      return;
    }

    const shape = buildSketchShape(draw.tool, draw.startLocal, effectiveCur);
    if (shape) {
      const pts = getSketchShapePoints(shape, sketchMesh);
      const line = makePreviewLine2(pts);
      if (line) {
        scene.add(line);
        draw.previewObjects.push(line);
      }
    }
    if (dimHintRef.current) {
      const rect = renderer.domElement.getBoundingClientRect();
      dimHintRef.current.textContent = sketchDimText(
        draw.tool,
        draw.startLocal,
        effectiveCur,
      );
      dimHintRef.current.style.display = "block";
      dimHintRef.current.style.left = `${screenX - rect.left + 16}px`;
      dimHintRef.current.style.top = `${screenY - rect.top - 10}px`;
    }
  };

  const handleSketchClick = (screenX, screenY, shiftKey = false) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!sketchMesh) return;
    let localPt = screenToSketchLocal(screenX, screenY, sketchMesh);
    if (!localPt) return;

    const shapes = selItem?.shapes || [];
    let clickSnap = null;
    if (!shiftKey) {
      clickSnap = findSnap(screenX, screenY, shapes, sketchMesh);
      if (clickSnap) localPt = { x: clickSnap.x, y: clickSnap.y };
    }

    // Helper: build constraints from recorded snaps for a completed shape
    const buildConstraints = (snaps, tool) => {
      const newIdx = shapes.length;
      return snaps
        .map((snap, i) => {
          if (!snap) return null;
          const pointKeys =
            tool === "bezier" ? ["p0", "p1", "p2", "p3"] : ["start", "end"];
          return {
            type: "coincident",
            shapeAIdx: newIdx,
            pointA: pointKeys[i] ?? `p${i}`,
            shapeBIdx: snap.shapeIdx,
            pointB: snap.pointKey,
          };
        })
        .filter(Boolean);
    };

    if (!sketchDrawRef.current) {
      sketchDrawRef.current = {
        tool: activeSketchToolRef.current,
        startLocal: localPt,
        points: [localPt],
        snaps: [clickSnap],
        chainStartPoint: localPt,
        previewObjects: [],
      };
      setSketchDrawPhase("second");
    } else if (sketchDrawRef.current.tool === "bezier") {
      const draw = sketchDrawRef.current;
      draw.points.push(localPt);
      draw.snaps.push(clickSnap);
      if (draw.points.length === 4) {
        const [p0, p1, p2, p3] = draw.points;
        const constraints = buildConstraints(draw.snaps, "bezier");
        clearSketchPreview();
        clearSnapIndicator();
        if (dimHintRef.current) dimHintRef.current.style.display = "none";
        useStore
          .getState()
          .addSketchShape(
            selectedIdRef.current,
            { type: "bezier", p0, p1, p2, p3 },
            constraints,
          );
        const chainStart = draw.chainStartPoint;
        const closesChain =
          clickSnap &&
          chainStart &&
          Math.hypot(p3.x - chainStart.x, p3.y - chainStart.y) < 0.01;
        if (closesChain) {
          sketchDrawRef.current = null;
          setSketchDrawPhase("first");
          useStore.getState().setActiveSketchTool(null);
        } else {
          const contSnap = draw.snaps[3] ?? {
            shapeIdx: shapes.length,
            pointKey: "p3",
            x: p3.x,
            y: p3.y,
          };
          sketchDrawRef.current = {
            tool: "bezier",
            startLocal: { x: p3.x, y: p3.y },
            points: [{ x: p3.x, y: p3.y }],
            snaps: [contSnap],
            chainStartPoint: chainStart,
            previewObjects: [],
          };
          setSketchDrawPhase("second");
        }
      }
    } else if (sketchDrawRef.current.tool === "rect") {
      const draw = sketchDrawRef.current;
      draw.snaps.push(clickSnap);
      const shape = buildSketchShape("rect", draw.startLocal, localPt);
      clearSketchPreview();
      clearSnapIndicator();
      sketchDrawRef.current = null;
      setSketchDrawPhase("first");
      if (dimHintRef.current) dimHintRef.current.style.display = "none";
      if (shape) {
        const sx = shape.x1,
          sy = shape.y1,
          ex = shape.x2,
          ey = shape.y2;
        const n = shapes.length;
        useStore.getState().addSketchShapes(
          selectedIdRef.current,
          [
            { type: "line", x1: sx, y1: sy, x2: ex, y2: sy }, // top — horizontal
            { type: "line", x1: ex, y1: sy, x2: ex, y2: ey }, // right — vertical
            { type: "line", x1: ex, y1: ey, x2: sx, y2: ey }, // bottom — horizontal
            { type: "line", x1: sx, y1: ey, x2: sx, y2: sy }, // left — vertical
          ],
          [
            {
              type: "coincident",
              shapeAIdx: n,
              pointA: "end",
              shapeBIdx: n + 1,
              pointB: "start",
            },
            {
              type: "coincident",
              shapeAIdx: n + 1,
              pointA: "end",
              shapeBIdx: n + 2,
              pointB: "start",
            },
            {
              type: "coincident",
              shapeAIdx: n + 2,
              pointA: "end",
              shapeBIdx: n + 3,
              pointB: "start",
            },
            {
              type: "coincident",
              shapeAIdx: n + 3,
              pointA: "end",
              shapeBIdx: n,
              pointB: "start",
            },
            { type: "horizontal", shapeIdx: n },
            { type: "vertical", shapeIdx: n + 1 },
            { type: "horizontal", shapeIdx: n + 2 },
            { type: "vertical", shapeIdx: n + 3 },
          ],
        );
      }
      useStore.getState().setActiveSketchTool(null);
    } else {
      const draw = sketchDrawRef.current;
      draw.snaps.push(clickSnap);
      const shape = buildSketchShape(draw.tool, draw.startLocal, localPt);
      const constraints = buildConstraints(draw.snaps, draw.tool);
      clearSketchPreview();
      clearSnapIndicator();
      if (dimHintRef.current) dimHintRef.current.style.display = "none";
      if (draw.tool === "line") {
        if (shape)
          useStore
            .getState()
            .addSketchShape(selectedIdRef.current, shape, constraints);
        const chainStart = draw.chainStartPoint;
        const closesChain =
          clickSnap &&
          chainStart &&
          Math.hypot(localPt.x - chainStart.x, localPt.y - chainStart.y) < 0.01;
        if (closesChain) {
          sketchDrawRef.current = null;
          setSketchDrawPhase("first");
          useStore.getState().setActiveSketchTool(null);
        } else {
          const contSnap = clickSnap ?? {
            shapeIdx: shapes.length,
            pointKey: "end",
            x: localPt.x,
            y: localPt.y,
          };
          sketchDrawRef.current = {
            tool: "line",
            startLocal: localPt,
            points: [localPt],
            snaps: [contSnap],
            chainStartPoint: chainStart,
            previewObjects: [],
          };
          setSketchDrawPhase("second");
        }
      } else {
        // circle, ellipse, arc: complete the shape and deselect the tool
        sketchDrawRef.current = null;
        setSketchDrawPhase("first");
        if (shape)
          useStore
            .getState()
            .addSketchShape(selectedIdRef.current, shape, constraints);
        useStore.getState().setActiveSketchTool(null);
      }
    }
  };

  // ── Highlight helpers ──────────────────────────────────────────────────────

  const clearHL = (ref) => {
    if (ref.current) {
      scene.remove(ref.current);
      ref.current.geometry.dispose();
      ref.current.material.dispose();
      ref.current = null;
    }
  };

  // Persistent data from the most-recent hover highlight, used to commit
  // face/edge selection to the store when the user clicks.
  let pendingFaceSelection = null; // { itemId, nx, ny, nz }
  let pendingEdgeSelection = null; // { itemId, ax, ay, az, bx, by, bz }

  const clearFaceHighlight = () => {
    clearHL(faceHighlightRef);
    pendingFaceSelection = null;
  };
  const clearEdgeHighlight = () => {
    clearHL(edgeHighlightRef);
    pendingEdgeSelection = null;
  };
  const clearPointHighlight = () => clearHL(pointHighlightRef);

  const primitiveGeoForHighlight = (type) => {
    // Hover & selection highlights are DISPLAY overlays on the smooth
    // shader render — they must visually match the shader, not the
    // (potentially coarse) CSG/bevel resolution.  Always tessellate at
    // DISPLAY_PRECISION_MM, or finer if the user has print mode enabled.
    // Radii MUST exactly match the shader's primitive dimensions (sphere
    // r=1.5, cylinder r=1 h=2, torus r=1 tube=0.4); the previous tiny
    // inflation (1.53, 1.015, 1.01/0.42) was a z-fighting workaround for
    // depth-tested materials, but the highlight material uses
    // depthTest:false + high renderOrder, so an inflated overlay just
    // visibly extends past the actual primitive.
    const printPrecisionMm =
      useStore.getState().curveResolution === "print" ? 0.01 : null;
    const displayPrecision =
      printPrecisionMm != null
        ? Math.min(printPrecisionMm, DISPLAY_PRECISION_MM)
        : DISPLAY_PRECISION_MM;
    if (type === "sphere") {
      const w = fullCircleSegments(1.5, displayPrecision, 32);
      const h = Math.max(8, Math.round(w / 2));
      return new THREE.SphereGeometry(1.5, w, h);
    }
    if (type === "cylinder") {
      const s = fullCircleSegments(1, displayPrecision, 32);
      return new THREE.CylinderGeometry(1, 1, 2, s);
    }
    if (type === "torus") {
      // THREE.TorusGeometry ring is in XY plane; our torus shader ring is in
      // XZ plane.  Rotate -90° around X to align.
      const tubular = fullCircleSegments(1.0, displayPrecision, 32);
      const radial = fullCircleSegments(0.4, displayPrecision, 16);
      const geo = new THREE.TorusGeometry(1.0, 0.4, radial, tubular);
      geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      return geo;
    }
    return null;
  };

  const applyFaceHighlight = (hit, color) => {
    const hitMesh = hit.object;
    const hitNormal = hit.face.normal;
    const itemData = itemsRef.current.find(
      (i) => i.id === hitMesh.userData.itemId,
    );
    const primitiveType = ["sphere", "cylinder", "torus"].includes(
      itemData?.type,
    )
      ? itemData.type
      : null;

    const workGeo = primitiveType
      ? primitiveGeoForHighlight(primitiveType)
      : hitMesh.geometry;
    const posAttr = workGeo.getAttribute("position");
    const indexAttr = workGeo.index;
    const triCount = indexAttr ? indexAttr.count / 3 : posAttr.count / 3;
    const vA = new THREE.Vector3(),
      vB = new THREE.Vector3(),
      vC = new THREE.Vector3();
    const triNormal = new THREE.Vector3();
    const matchVerts = [];

    // For primitives, convert world-space hit normal to local space for region matching
    let localNormal = hitNormal;
    if (primitiveType) {
      const invMatrix = new THREE.Matrix4().copy(hitMesh.matrixWorld).invert();
      localNormal = hitNormal.clone().transformDirection(invMatrix).normalize();
    }

    for (let i = 0; i < triCount; i++) {
      let a, b, c;
      if (indexAttr) {
        a = indexAttr.getX(i * 3);
        b = indexAttr.getX(i * 3 + 1);
        c = indexAttr.getX(i * 3 + 2);
      } else {
        a = i * 3;
        b = i * 3 + 1;
        c = i * 3 + 2;
      }
      vA.set(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a));
      vB.set(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b));
      vC.set(posAttr.getX(c), posAttr.getY(c), posAttr.getZ(c));
      triNormal
        .crossVectors(
          new THREE.Vector3().subVectors(vB, vA),
          new THREE.Vector3().subVectors(vC, vA),
        )
        .normalize();
      if (primitiveType === "cylinder") {
        // Separate top cap / bottom cap / side by local normal Y component
        const topHit = localNormal.y > 0.9,
          botHit = localNormal.y < -0.9;
        const isTop = triNormal.y > 0.9,
          isBot = triNormal.y < -0.9,
          isSide = Math.abs(triNormal.y) < 0.1;
        if (
          (topHit && isTop) ||
          (botHit && isBot) ||
          (!topHit && !botHit && isSide)
        )
          matchVerts.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
      } else if (primitiveType) {
        // Sphere / torus: entire surface is one face region
        matchVerts.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
      } else {
        if (Math.abs(triNormal.dot(localNormal)) > 0.999)
          matchVerts.push(vA.x, vA.y, vA.z, vB.x, vB.y, vB.z, vC.x, vC.y, vC.z);
      }
    }
    if (primitiveType) workGeo.dispose();

    clearFaceHighlight();
    if (matchVerts.length > 0) {
      const hlGeo = new THREE.BufferGeometry();
      hlGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(new Float32Array(matchVerts), 3),
      );
      const hlMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        depthTest: primitiveType ? false : true,
        side: THREE.DoubleSide,
        polygonOffset: !primitiveType,
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
      // Record for click-to-select
      pendingFaceSelection = {
        itemId: hitMesh.userData.itemId,
        nx: localNormal.x,
        ny: localNormal.y,
        nz: localNormal.z,
      };
    }
  };

  const distToSeg = (p, a, b) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ap = new THREE.Vector3().subVectors(p, a);
    const t = Math.max(
      0,
      Math.min(1, ap.dot(ab) / Math.max(ab.lengthSq(), 1e-10)),
    );
    return p.distanceTo(
      new THREE.Vector3().addVectors(a, ab.multiplyScalar(t)),
    );
  };

  const applyEdgeHighlight = (hit) => {
    clearEdgeHighlight();
    const hitMesh = hit.object;
    const localHit = hitMesh.worldToLocal(hit.point.clone());
    const itemData = itemsRef.current.find(
      (i) => i.id === hitMesh.userData.itemId,
    );
    const primitiveType = ["sphere", "cylinder", "torus"].includes(
      itemData?.type,
    )
      ? itemData.type
      : null;
    const srcGeo = primitiveType
      ? primitiveGeoForHighlight(primitiveType)
      : hitMesh.geometry;
    const edgesGeo = new THREE.EdgesGeometry(srcGeo);
    if (primitiveType) srcGeo.dispose();
    const posAttr = edgesGeo.getAttribute("position");
    let minDist = Infinity,
      bestA = null,
      bestB = null;
    for (let i = 0; i < posAttr.count; i += 2) {
      const a = new THREE.Vector3(
        posAttr.getX(i),
        posAttr.getY(i),
        posAttr.getZ(i),
      );
      const b = new THREE.Vector3(
        posAttr.getX(i + 1),
        posAttr.getY(i + 1),
        posAttr.getZ(i + 1),
      );
      const d = distToSeg(localHit, a, b);
      if (d < minDist) {
        minDist = d;
        bestA = a;
        bestB = b;
      }
    }
    edgesGeo.dispose();
    if (bestA) {
      const hlGeo = new THREE.BufferGeometry();
      hlGeo.setAttribute(
        "position",
        new THREE.BufferAttribute(
          new Float32Array([
            bestA.x,
            bestA.y,
            bestA.z,
            bestB.x,
            bestB.y,
            bestB.z,
          ]),
          3,
        ),
      );
      const hlLine = new THREE.LineSegments(
        hlGeo,
        new THREE.LineBasicMaterial({ color: 0xffdd00, depthTest: false }),
      );
      hlLine.position.copy(hitMesh.position);
      hlLine.rotation.copy(hitMesh.rotation);
      hlLine.scale.copy(hitMesh.scale);
      hlLine.renderOrder = 998;
      scene.add(hlLine);
      edgeHighlightRef.current = hlLine;
      // Record for click-to-select
      pendingEdgeSelection = {
        itemId: hitMesh.userData.itemId,
        ax: bestA.x,
        ay: bestA.y,
        az: bestA.z,
        bx: bestB.x,
        by: bestB.y,
        bz: bestB.z,
      };
    }
  };

  const applyPointHighlight = (hit) => {
    clearPointHighlight();
    const hitMesh = hit.object;
    const localHit = hitMesh.worldToLocal(hit.point.clone());
    const itemData = itemsRef.current.find(
      (i) => i.id === hitMesh.userData.itemId,
    );
    const primitiveType = ["sphere", "cylinder", "torus"].includes(
      itemData?.type,
    )
      ? itemData.type
      : null;
    const srcGeo = primitiveType
      ? primitiveGeoForHighlight(primitiveType)
      : hitMesh.geometry;
    const posAttr = srcGeo.getAttribute("position");
    let minDist = Infinity,
      bestV = null;
    const seen = new Set();
    for (let i = 0; i < posAttr.count; i++) {
      const v = new THREE.Vector3(
        posAttr.getX(i),
        posAttr.getY(i),
        posAttr.getZ(i),
      );
      const key = `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const d = v.distanceTo(localHit);
      if (d < minDist) {
        minDist = d;
        bestV = v.clone();
      }
    }
    if (primitiveType) srcGeo.dispose();
    if (bestV) {
      bestV.applyMatrix4(hitMesh.matrixWorld);
      const hlMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xff44aa, depthTest: false }),
      );
      hlMesh.position.copy(bestV);
      hlMesh.renderOrder = 999;
      scene.add(hlMesh);
      pointHighlightRef.current = hlMesh;
    }
  };

  // ── Mouse event handlers ───────────────────────────────────────────────────

  const onMouseDown = (e) => {
    if (e.button === 0) {
      if (extrudeSelectModeRef && extrudeSelectModeRef.current) {
        controls.mouseDownX = e.clientX;
        controls.mouseDownY = e.clientY;
        return;
      }
      if (sketchModeRef.current && activeSketchToolRef.current) {
        controls.mouseDownX = e.clientX;
        controls.mouseDownY = e.clientY;
        controls.mouseX = e.clientX;
        controls.mouseY = e.clientY;
        return;
      }
      if (sketchModeRef.current && !activeSketchToolRef.current) {
        controls.mouseDownX = e.clientX;
        controls.mouseDownY = e.clientY;
        if (!useStore.getState().sketchModifyMode) {
          const didDrag = startSketchDrag(e.clientX, e.clientY, e.shiftKey);
          if (!didDrag) {
            clearMultiSelectOverlays();
            multiSelectedIndices = [];
            marqueeStartScreen = { x: e.clientX, y: e.clientY };
          }
        }
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera({ x: nx, y: ny }, cameraRef.current);

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

              const startDescendantPositions = {};
              const startDescendantQuaternions = {};
              const collectDescendants = (pid) => {
                itemsRef.current.forEach((di) => {
                  if (di.parentId === pid) {
                    const dMesh = objectsRef.current[di.id];
                    if (dMesh) {
                      startDescendantPositions[di.id] = dMesh.position.clone();
                      startDescendantQuaternions[di.id] =
                        dMesh.quaternion.clone();
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
                startParentQuaternion: isRotHandle
                  ? mesh.quaternion.clone()
                  : null,
                itemId: selId,
                startDescendantPositions,
                startDescendantQuaternions,
              };
              controls.mouseDownX = e.clientX;
              controls.mouseDownY = e.clientY;
              controls.mouseX = e.clientX;
              controls.mouseY = e.clientY;
              return;
            }
          }
        }
      }
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
      else if (extrudeSelectModeRef.current === "depth")
        handleExtrudeDepthMove(e.clientX, e.clientY);
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
      return;
    }
    if (sketchModeRef.current && activeSketchToolRef.current) {
      clearAllSketchHover();
      updateSketchPreview(e.clientX, e.clientY, e.shiftKey);
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
      return;
    }
    if (sketchModeRef.current && !activeSketchToolRef.current) {
      if (sketchDrag) {
        applySketchDragMove(e.clientX, e.clientY, e.shiftKey);
      } else {
        const modifyMode = useStore.getState().sketchModifyMode;
        if (modifyMode) {
          clearAllSketchHover();
          showModifyPreview(e.clientX, e.clientY, modifyMode);
        } else if (marqueeStartScreen) {
          clearAllSketchHover();
          clearModifyPreview();
          const dx = e.clientX - marqueeStartScreen.x;
          const dy = e.clientY - marqueeStartScreen.y;
          if (Math.hypot(dx, dy) > 5) {
            marqueeActive = true;
            updateMarquee(e.clientX, e.clientY);
          }
        } else {
          clearModifyPreview();
          updateHoverFills(e.clientX, e.clientY);
          updateSketchHover(e.clientX, e.clientY);
        }
      }
      controls.mouseX = e.clientX;
      controls.mouseY = e.clientY;
      return;
    }
    clearAllSketchHover();
    clearSketchSelectionOverlay();
    clearCoincidentFirstOverlay();

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

          if (drag.startParentQuaternion && drag.startDescendantPositions) {
            const deltaQuat = mesh.quaternion
              .clone()
              .multiply(drag.startParentQuaternion.clone().invert());
            Object.entries(drag.startDescendantPositions).forEach(
              ([idStr, startDPos]) => {
                const dMesh = objectsRef.current[parseInt(idStr, 10)];
                if (!dMesh) return;
                const relPos = startDPos.clone().sub(mesh.position);
                relPos.applyQuaternion(deltaQuat);
                dMesh.position.copy(mesh.position).add(relPos);
                const startDQuat = drag.startDescendantQuaternions?.[idStr];
                if (startDQuat)
                  dMesh.quaternion.copy(deltaQuat.clone().multiply(startDQuat));
              },
            );
          }
        } else if (drag.handleType === "scale") {
          mesh.scale.setScalar(
            Math.max(0.05, drag.startScale * Math.pow(2, -dyPx / 200)),
          );
        } else {
          const dxNDC = (dxPx / rect.width) * 2;
          const dyNDC = (-dyPx / rect.height) * 2;
          const projected = drag.axisDirScreen
            ? dxNDC * drag.axisDirScreen.x + dyNDC * drag.axisDirScreen.y
            : 0;
          mesh.position
            .copy(drag.startPos)
            .addScaledVector(drag.dir, projected * drag.worldPerNDC);

          if (drag.startDescendantPositions) {
            const delta = new THREE.Vector3().subVectors(
              mesh.position,
              drag.startPos,
            );
            Object.entries(drag.startDescendantPositions).forEach(
              ([idStr, startDPos]) => {
                const dMesh = objectsRef.current[parseInt(idStr, 10)];
                if (dMesh) dMesh.position.copy(startDPos).add(delta);
              },
            );
          }
        }

        const item = itemsRef.current.find((i) => i.id === drag.itemId);
        const ext = getObjectExtent(item ? item.type : "cube", mesh.scale.x);
        handlesRef.current.forEach(({ mesh: hm, dir }) => {
          if (dir)
            hm.position.copy(mesh.position).addScaledVector(dir, ext + 0.5);
          else hm.position.copy(mesh.position);
        });

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

    // ── Hover highlighting ────────────────────────────────────────────────
    const rect = renderer.domElement.getBoundingClientRect();
    mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycasterRef.current.setFromCamera(mouseRef.current, currentCamera);
    const meshArray = Object.values(objectsRef.current).filter((m) => {
      const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
      return it?.type !== "sketch" && m.visible !== false;
    });
    const intersects = raycasterRef.current.intersectObjects(meshArray, false);

    if (sketchPlacementModeRef.current) {
      setHoveredId(null);
      sketchPlacementPlanesRef.current.forEach(({ mesh }) => {
        mesh.material.opacity = 0.18;
      });
      if (intersects.length > 0) {
        applyFaceHighlight(intersects[0], 0xff8833);
      } else {
        clearFaceHighlight();
        const planeMeshes = sketchPlacementPlanesRef.current.map((p) => p.mesh);
        const planeHits = raycasterRef.current.intersectObjects(
          planeMeshes,
          false,
        );
        if (planeHits.length > 0) planeHits[0].object.material.opacity = 0.45;
      }
    } else {
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      const edgeMode = e.shiftKey && !cmdOrCtrl;
      const pointMode = e.shiftKey && cmdOrCtrl;
      const faceMode = !e.shiftKey && cmdOrCtrl;

      if (pointMode) {
        setHoveredId(null);
        clearFaceHighlight();
        clearEdgeHighlight();
        if (intersects.length > 0) applyPointHighlight(intersects[0]);
        else clearPointHighlight();
      } else if (edgeMode) {
        setHoveredId(null);
        clearFaceHighlight();
        clearPointHighlight();
        if (intersects.length > 0) applyEdgeHighlight(intersects[0]);
        else clearEdgeHighlight();
      } else if (faceMode) {
        setHoveredId(null);
        clearEdgeHighlight();
        clearPointHighlight();
        if (intersects.length > 0) applyFaceHighlight(intersects[0], 0x88ccff);
        else clearFaceHighlight();
      } else {
        clearFaceHighlight();
        clearEdgeHighlight();
        clearPointHighlight();
        setHoveredId(
          intersects.length > 0
            ? intersects[0].object.userData.itemId || null
            : null,
        );
      }
    }

    controls.mouseX = e.clientX;
    controls.mouseY = e.clientY;
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
        else if (extrudeSelectModeRef.current === "depth")
          finalizeExtrude(e.clientX, e.clientY);
      }
      return;
    }
    if (
      sketchModeRef.current &&
      activeSketchToolRef.current &&
      e.button === 0
    ) {
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5)
        handleSketchClick(e.clientX, e.clientY, e.shiftKey);
      return;
    }
    if (
      sketchModeRef.current &&
      !activeSketchToolRef.current &&
      e.button === 0
    ) {
      if (marqueeActive) {
        marqueeActive = false;
        marqueeStartScreen = null;
        clearMarqueeRect();
        renderer.domElement.style.cursor = "";
        return;
      }
      marqueeStartScreen = null;
      const constraintMode = useStore.getState().sketchConstraintMode;
      const doClick = (sx, sy, shift = false) => {
        const modifyMode = useStore.getState().sketchModifyMode;
        if (modifyMode) {
          applyModify(sx, sy, modifyMode);
          return;
        }
        if (constraintMode === "coincident") {
          handleCoincidentClick(sx, sy);
          return;
        }
        if (constraintMode === "distance") {
          handleDistanceConstraintClick(sx, sy);
          return;
        }

        const now = Date.now();
        const isDblClick =
          now - lastClickTime < 300 &&
          Math.hypot(sx - lastClickX, sy - lastClickY) < 8;
        lastClickTime = now;
        lastClickX = sx;
        lastClickY = sy;

        if (isDblClick) {
          // Check if double-clicking on a distance constraint icon to edit its value
          const dblG = sketchShapesGroupRef?.current;
          const dblSel = itemsRef.current.find(
            (i) => i.id === selectedIdRef.current,
          );
          const dblMesh = dblSel ? objectsRef.current[dblSel.id] : null;
          if (dblG && dblMesh) {
            const rect2 = renderer.domElement.getBoundingClientRect();
            for (const cObj of dblG.children) {
              if (
                !cObj.userData.isConstraint ||
                cObj.userData.constraintType !== "distance"
              )
                continue;
              const lp = cObj.userData.constraintIconLocalPos;
              if (!lp) continue;
              const wp = new THREE.Vector3(lp.x, lp.y, 0.005)
                .applyQuaternion(dblMesh.quaternion)
                .add(dblMesh.position);
              const ndc2 = wp.clone().project(cameraRef.current);
              const cpx = ((ndc2.x + 1) / 2) * rect2.width + rect2.left;
              const cpy = ((-ndc2.y + 1) / 2) * rect2.height + rect2.top;
              if (Math.hypot(sx - cpx, sy - cpy) < 18) {
                const c = (dblSel.constraints || [])[
                  cObj.userData.constraintIdx
                ];
                if (c && c.type === "distance") {
                  useStore.getState().setSketchDistanceInput({
                    shapeAIdx: c.shapeAIdx,
                    pointA: c.pointA,
                    shapeBIdx: c.shapeBIdx,
                    pointB: c.pointB,
                    defaultDistance: c.distance,
                    constraintIdx: cObj.userData.constraintIdx,
                  });
                  useStore.getState().setSketchConstraintMode("distance");
                }
                return;
              }
            }
          }

          // Otherwise select all lines reachable via coincident constraints
          clearMultiSelectOverlays();
          multiSelectedIndices = [];
          const selItem = itemsRef.current.find(
            (i) => i.id === selectedIdRef.current,
          );
          const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
          const sketchGroup = sketchShapesGroupRef?.current;
          if (selItem && sketchMesh && sketchGroup) {
            const lineObjs = sketchGroup.children.filter(
              (c) => c.userData.shapeIdx != null,
            );
            const hits = hitTestSketchLines(makeRay(sx, sy), lineObjs);
            if (hits.length > 0 && hits[0].object.userData.shapeIdx != null) {
              const connected = collectConnectedShapes(
                hits[0].object.userData.shapeIdx,
                selItem.shapes || [],
                selItem.constraints || [],
              );
              multiSelectedIndices = connected;
              showMultiSelectOverlays(connected);
            }
          }
          return;
        }

        if (shift) {
          // Shift+click: toggle the hit line in/out of the multi-selection
          const sketchGroup = sketchShapesGroupRef?.current;
          if (!sketchGroup) return;
          const lineObjs = sketchGroup.children.filter(
            (c) => c.userData.shapeIdx != null,
          );
          const hits = hitTestSketchLines(makeRay(sx, sy), lineObjs);
          if (hits.length > 0 && hits[0].object.userData.shapeIdx != null) {
            const hitIdx = hits[0].object.userData.shapeIdx;
            multiSelectedIndices = multiSelectedIndices.includes(hitIdx)
              ? multiSelectedIndices.filter((i) => i !== hitIdx)
              : [...multiSelectedIndices, hitIdx];
            showMultiSelectOverlays(multiSelectedIndices);
          }
          return;
        }

        // Check for constraint icon click before doing normal element select
        {
          const cg = sketchShapesGroupRef?.current;
          const cSelItem = itemsRef.current.find(
            (i) => i.id === selectedIdRef.current,
          );
          const cMesh = cSelItem ? objectsRef.current[cSelItem.id] : null;
          if (cg && cMesh) {
            const cRect = renderer.domElement.getBoundingClientRect();
            for (const cObj of cg.children) {
              if (!cObj.userData.isConstraint) continue;
              const lp = cObj.userData.constraintIconLocalPos;
              if (!lp) continue;
              const wp = new THREE.Vector3(lp.x, lp.y, 0.005)
                .applyQuaternion(cMesh.quaternion)
                .add(cMesh.position);
              const ndc = wp.clone().project(cameraRef.current);
              const cpx = ((ndc.x + 1) / 2) * cRect.width + cRect.left;
              const cpy = ((-ndc.y + 1) / 2) * cRect.height + cRect.top;
              if (Math.hypot(sx - cpx, sy - cpy) < 14) {
                clearMultiSelectOverlays();
                multiSelectedIndices = [];
                selectConstraint(cObj.userData.constraintIdx);
                return;
              }
            }
          }
        }
        clearConstraintSelection();

        // Normal click: clear multi-selection and do single-element select
        clearMultiSelectOverlays();
        multiSelectedIndices = [];
        trySelectSketchElement(sx, sy);
      };
      if (sketchDrag) {
        const wasDrag = !!sketchDrag.pendingShape;
        if (wasDrag) commitSketchDrag();
        sketchDrag = null;
        clearDragIndicator();
        renderer.domElement.style.cursor = "";
        if (!wasDrag) doClick(e.clientX, e.clientY, e.shiftKey);
        return;
      }
      const dx = e.clientX - (controls.mouseDownX ?? e.clientX);
      const dy = e.clientY - (controls.mouseDownY ?? e.clientY);
      if (Math.hypot(dx, dy) < 5) doClick(e.clientX, e.clientY, e.shiftKey);
      return;
    }

    if (handleDragRef.current) {
      const drag = handleDragRef.current;
      const mesh = objectsRef.current[drag.itemId];
      if (mesh) {
        if (drag.handleType.startsWith("rot")) {
          useStore.getState().setItemTransform(drag.itemId, null, null, {
            x: mesh.rotation.x,
            y: mesh.rotation.y,
            z: mesh.rotation.z,
          });
          if (
            drag.startDescendantPositions &&
            Object.keys(drag.startDescendantPositions).length > 0
          ) {
            const updates = Object.keys(drag.startDescendantPositions)
              .map((idStr) => {
                const dMesh = objectsRef.current[parseInt(idStr, 10)];
                if (!dMesh) return null;
                return {
                  id: parseInt(idStr, 10),
                  position: {
                    x: dMesh.position.x,
                    y: dMesh.position.y,
                    z: dMesh.position.z,
                  },
                  rotation: {
                    x: dMesh.rotation.x,
                    y: dMesh.rotation.y,
                    z: dMesh.rotation.z,
                  },
                };
              })
              .filter(Boolean);
            if (updates.length > 0)
              useStore.getState().setItemsTransform(updates);
          }
        } else {
          // For extrude meshes, mesh.position = item.position + rotated_centroid_offset.
          // We must subtract the offset before storing so that the next buildSceneObjects
          // call re-applies it and the solid stays in the same world position.
          const elo = mesh.userData.extrudeLocalOffset;
          let commitPos;
          if (elo) {
            const offsetWorld = new THREE.Vector3(
              elo.x,
              elo.y,
              elo.z,
            ).applyEuler(mesh.rotation);
            commitPos = {
              x: mesh.position.x - offsetWorld.x,
              y: mesh.position.y - offsetWorld.y,
              z: mesh.position.z - offsetWorld.z,
            };
          } else {
            commitPos = {
              x: mesh.position.x,
              y: mesh.position.y,
              z: mesh.position.z,
            };
          }
          useStore
            .getState()
            .setItemTransform(
              drag.itemId,
              commitPos,
              { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z },
              null,
            );
          if (
            drag.startDescendantPositions &&
            Object.keys(drag.startDescendantPositions).length > 0
          ) {
            const updates = Object.keys(drag.startDescendantPositions)
              .map((idStr) => {
                const dMesh = objectsRef.current[parseInt(idStr, 10)];
                if (!dMesh) return null;
                const dElo = dMesh.userData.extrudeLocalOffset;
                let dPos;
                if (dElo) {
                  const dOffsetWorld = new THREE.Vector3(
                    dElo.x,
                    dElo.y,
                    dElo.z,
                  ).applyEuler(dMesh.rotation);
                  dPos = {
                    x: dMesh.position.x - dOffsetWorld.x,
                    y: dMesh.position.y - dOffsetWorld.y,
                    z: dMesh.position.z - dOffsetWorld.z,
                  };
                } else {
                  dPos = {
                    x: dMesh.position.x,
                    y: dMesh.position.y,
                    z: dMesh.position.z,
                  };
                }
                return { id: parseInt(idStr, 10), position: dPos };
              })
              .filter(Boolean);
            if (updates.length > 0)
              useStore.getState().setItemsTransform(updates);
          }
        }

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

          const objHits = raycasterRef.current.intersectObjects(
            Object.values(objectsRef.current).filter(
              (m) => m.visible !== false,
            ),
            false,
          );
          let position, rotation;
          if (objHits.length > 0) {
            const hit = objHits[0];
            const normalMatrix = new THREE.Matrix3().getNormalMatrix(
              hit.object.matrixWorld,
            );
            const worldNormal = hit.face.normal
              .clone()
              .applyMatrix3(normalMatrix)
              .normalize();
            const q = new THREE.Quaternion().setFromUnitVectors(
              new THREE.Vector3(0, 0, 1),
              worldNormal,
            );
            const euler = new THREE.Euler().setFromQuaternion(q);
            position = { x: hit.point.x, y: hit.point.y, z: hit.point.z };
            rotation = { x: euler.x, y: euler.y, z: euler.z };
          } else {
            const planeMeshes = sketchPlacementPlanesRef.current.map(
              (p) => p.mesh,
            );
            const planeHits = raycasterRef.current.intersectObjects(
              planeMeshes,
              false,
            );
            if (planeHits.length > 0) {
              const hitPlane = sketchPlacementPlanesRef.current.find(
                (p) => p.mesh === planeHits[0].object,
              );
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
              if (
                entry.instruction?.type === "create" &&
                entry.instruction.item.id > maxId
              )
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
          } else {
            useStore.getState().setSketchPlacementMode(false);
          }
        }
      }
      save();
      return;
    }

    if (sketchModeRef.current) {
      save();
      return;
    }

    const currentCamera = cameraRef.current;
    if (currentCamera) {
      const rect = renderer.domElement.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycasterRef.current.setFromCamera({ x: nx, y: ny }, currentCamera);
      const selectableMeshes = Object.values(objectsRef.current).filter((m) => {
        if (!m.visible) return false;
        const it = itemsRef.current.find((i) => i.id === m.userData.itemId);
        return it?.type !== "sketch";
      });
      const intersects = raycasterRef.current.intersectObjects(
        selectableMeshes,
        false,
      );
      const cmdOrCtrl3d = isMac ? e.metaKey : e.ctrlKey;
      if (intersects.length > 0) {
        const clickedId = intersects[0].object.userData.itemId || null;
        if (
          cmdOrCtrl3d &&
          !e.shiftKey &&
          pendingFaceSelection &&
          pendingFaceSelection.itemId === clickedId
        ) {
          // Cmd/Ctrl+click in face mode: commit face to sub-geometry selection.
          // Faces and edges are mutually exclusive — always clear edges.
          const prev = useStore.getState().selectedSubGeometry;
          const faces =
            prev?.itemId === clickedId && prev.edges.length === 0
              ? [...prev.faces]
              : [];
          const n = pendingFaceSelection;
          const already = faces.some(
            (f) =>
              Math.abs(f.nx - n.nx) < 0.01 &&
              Math.abs(f.ny - n.ny) < 0.01 &&
              Math.abs(f.nz - n.nz) < 0.01,
          );
          useStore.getState().setSelectedSubGeometry({
            itemId: clickedId,
            edges: [],
            faces: already
              ? faces.filter(
                  (f) =>
                    !(
                      Math.abs(f.nx - n.nx) < 0.01 &&
                      Math.abs(f.ny - n.ny) < 0.01 &&
                      Math.abs(f.nz - n.nz) < 0.01
                    ),
                )
              : [...faces, { nx: n.nx, ny: n.ny, nz: n.nz }],
          });
          // Sub-geometry selection is exclusive with multi-object selection.
          selectItem(null);
          // Remove the hover overlay so the persistent selection highlight
          // (a darker shade, drawn at a lower renderOrder) becomes immediately
          // visible at click time.  Without this, the bright hover overlay
          // continues drawing over the selection until the next pointer move,
          // making the click appear to have no visual effect.
          clearFaceHighlight();
        } else if (
          e.shiftKey &&
          !cmdOrCtrl3d &&
          pendingEdgeSelection &&
          pendingEdgeSelection.itemId === clickedId
        ) {
          // Shift+click in edge mode: commit edge to sub-geometry selection.
          // Edges and faces are mutually exclusive — always clear faces.
          const prev = useStore.getState().selectedSubGeometry;
          const edges =
            prev?.itemId === clickedId && prev.faces.length === 0
              ? [...prev.edges]
              : [];
          const ed = pendingEdgeSelection;
          const already = edges.some(
            (e2) =>
              Math.abs(e2.ax - ed.ax) < 0.001 &&
              Math.abs(e2.ay - ed.ay) < 0.001 &&
              Math.abs(e2.az - ed.az) < 0.001 &&
              Math.abs(e2.bx - ed.bx) < 0.001 &&
              Math.abs(e2.by - ed.by) < 0.001 &&
              Math.abs(e2.bz - ed.bz) < 0.001,
          );
          useStore.getState().setSelectedSubGeometry({
            itemId: clickedId,
            edges: already
              ? edges.filter(
                  (e2) =>
                    !(
                      Math.abs(e2.ax - ed.ax) < 0.001 &&
                      Math.abs(e2.ay - ed.ay) < 0.001 &&
                      Math.abs(e2.az - ed.az) < 0.001 &&
                      Math.abs(e2.bx - ed.bx) < 0.001 &&
                      Math.abs(e2.by - ed.by) < 0.001 &&
                      Math.abs(e2.bz - ed.bz) < 0.001
                    ),
                )
              : [
                  ...edges,
                  {
                    ax: ed.ax,
                    ay: ed.ay,
                    az: ed.az,
                    bx: ed.bx,
                    by: ed.by,
                    bz: ed.bz,
                  },
                ],
            faces: [],
          });
          // Sub-geometry selection is exclusive with multi-object selection.
          selectItem(null);
          // Remove the hover overlay so the persistent selection highlight
          // becomes immediately visible at click time (same rationale as in
          // the face-commit branch above).
          clearEdgeHighlight();
        } else {
          // Normal click: select item and clear sub-geometry selection.
          useStore.getState().clearSelectedSubGeometry();
          if (e.shiftKey && clickedId)
            useStore.getState().addToSelection(clickedId);
          else selectItem(clickedId);
        }
      } else if (!e.shiftKey) {
        selectItem(null);
        useStore.getState().clearSelectedSubGeometry();
      }
    }
    save();
  };

  // ── Wheel handler ──────────────────────────────────────────────────────────

  let shiftScrollSessionTimer = null;

  const onMouseWheel = (e) => {
    e.preventDefault();
    const currentCamera = cameraRef.current;
    if (!currentCamera) return;

    if (sketchModeRef.current && !(e.ctrlKey && isMac)) {
      const forward = new THREE.Vector3();
      currentCamera.getWorldDirection(forward);
      const right = new THREE.Vector3()
        .crossVectors(forward, currentCamera.up)
        .normalize();
      const rect = renderer.domElement.getBoundingClientRect();
      const worldPerPx = currentCamera.isPerspectiveCamera
        ? (2 *
            currentCamera.position.distanceTo(targetRef.current) *
            Math.tan((currentCamera.fov * Math.PI) / 360)) /
          rect.height
        : (currentCamera.top - currentCamera.bottom) / rect.height;
      const panSpeed = worldPerPx * 1.2;
      const offset = new THREE.Vector3()
        .addScaledVector(right, e.deltaX * panSpeed)
        .addScaledVector(currentCamera.up, -e.deltaY * panSpeed);
      currentCamera.position.add(offset);
      targetRef.current.add(offset);
      currentCamera.lookAt(targetRef.current);
      save();
      return;
    }

    if (e.ctrlKey && isMac) {
      const scale = Math.exp(-e.deltaY * 0.04);
      const tgt = targetRef.current;
      if (currentCamera instanceof THREE.OrthographicCamera) {
        currentCamera.zoom = Math.max(
          0.05,
          Math.min(50, currentCamera.zoom * scale),
        );
        currentCamera.updateProjectionMatrix();
      } else {
        const dir = new THREE.Vector3().subVectors(currentCamera.position, tgt);
        const newDist = Math.max(0.5, Math.min(500, dir.length() / scale));
        currentCamera.position
          .copy(tgt)
          .addScaledVector(dir.normalize(), newDist);
        currentCamera.lookAt(tgt);
      }
      setRotationState(currentCamera.quaternion.clone());
      save();
      return;
    }

    if (e.metaKey || (e.ctrlKey && !isMac)) {
      const rect = renderer.domElement.getBoundingClientRect();
      const worldPerPx = currentCamera.isPerspectiveCamera
        ? (2 *
            currentCamera.position.distanceTo(targetRef.current) *
            Math.tan((currentCamera.fov * Math.PI) / 360)) /
          rect.height
        : (currentCamera.top - currentCamera.bottom) / rect.height;
      const forward = new THREE.Vector3();
      currentCamera.getWorldDirection(forward);
      const right = new THREE.Vector3()
        .crossVectors(forward, currentCamera.up)
        .normalize();
      const up = currentCamera.up.clone().normalize();
      const offset = new THREE.Vector3()
        .addScaledVector(right, e.deltaX * worldPerPx)
        .addScaledVector(up, -e.deltaY * worldPerPx);
      currentCamera.position.add(offset);
      targetRef.current.add(offset);
      currentCamera.lookAt(targetRef.current);
      setRotationState(currentCamera.quaternion.clone());
      save();
      return;
    }

    if (e.shiftKey) {
      if (shiftScrollSessionTimer === null) {
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
      clearTimeout(shiftScrollSessionTimer);
      shiftScrollSessionTimer = setTimeout(() => {
        shiftScrollSessionTimer = null;
        orbitIndicator.visible = false;
      }, 400);

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
    } else {
      const rect = renderer.domElement.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const groundPlane = new THREE.Plane(
        new THREE.Vector3(0, 1, 0),
        -targetRef.current.y,
      );
      const hitAt = (sx, sy) => {
        const nx = ((sx - rect.left) / rect.width) * 2 - 1;
        const ny = -((sy - rect.top) / rect.height) * 2 + 1;
        const r = new THREE.Raycaster();
        r.setFromCamera({ x: nx, y: ny }, currentCamera);
        const h = new THREE.Vector3();
        return r.ray.intersectPlane(groundPlane, h) ? h.clone() : null;
      };
      const h0 = hitAt(cx, cy),
        h1 = hitAt(cx + 100, cy),
        h2 = hitAt(cx, cy + 100);
      if (h0 && h1 && h2) {
        const panDxWorld = new THREE.Vector3()
          .subVectors(h1, h0)
          .divideScalar(100);
        const panDyWorld = new THREE.Vector3()
          .subVectors(h2, h0)
          .divideScalar(100);
        const worldOffset = new THREE.Vector3()
          .addScaledVector(panDxWorld, e.deltaX)
          .addScaledVector(panDyWorld, e.deltaY);
        currentCamera.position.x += worldOffset.x;
        currentCamera.position.z += worldOffset.z;
        targetRef.current.x += worldOffset.x;
        targetRef.current.z += worldOffset.z;
      } else {
        currentCamera.position.y -= e.deltaY * 0.05;
        targetRef.current.y -= e.deltaY * 0.05;
      }
      currentCamera.lookAt(targetRef.current);
    }
    save();
  };

  // ── Touch pinch-to-zoom ────────────────────────────────────────────────────

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

  // ── Keyboard ───────────────────────────────────────────────────────────────

  const onModifierUp = (e) => {
    if (e.key === "Meta" || e.key === "Control") {
      clearHL(faceHighlightRef);
      clearHL(pointHighlightRef);
    }
    if (e.key === "Shift") {
      clearHL(edgeHighlightRef);
      clearHL(pointHighlightRef);
    }
  };
  const cancelSketchDraw = () => {
    clearSketchPreview();
    clearSnapIndicator();
    clearHoverFills();
    sketchDrawRef.current = null;
    setSketchDrawPhase("first");
    if (dimHintRef.current) dimHintRef.current.style.display = "none";
    if (sketchDrag) {
      const sketchGroup = sketchShapesGroupRef?.current;
      if (sketchDrag.kind === "multi") {
        // Revert all shapes in the multi-drag back to their originals
        if (sketchGroup) {
          sketchDrag.multiIndices.forEach((idx, i) => {
            const lineObj = sketchGroup.children.find(
              (c) => c.userData.shapeIdx === idx && c.geometry?.setPositions,
            );
            if (lineObj)
              updateSketchLineGeo(
                lineObj,
                sketchDrag.multiOrigShapes[i],
                sketchDrag.sketchMesh,
              );
          });
        }
      } else if (sketchGroup && sketchDrag.origShape) {
        const lineObj = sketchGroup.children.find(
          (c) =>
            c.userData.shapeIdx === sketchDrag.shapeIdx &&
            c.geometry?.setPositions,
        );
        if (lineObj)
          updateSketchLineGeo(
            lineObj,
            sketchDrag.origShape,
            sketchDrag.sketchMesh,
          );
      }
      sketchDrag = null;
      clearDragIndicator();
      renderer.domElement.style.cursor = "";
    }
  };

  const onKeyDown = (e) => {
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable)
      return;

    if (
      sketchModeRef.current &&
      (isMac ? e.metaKey : e.ctrlKey) &&
      e.key === "c"
    ) {
      const selItem = itemsRef.current.find(
        (i) => i.id === selectedIdRef.current,
      );
      if (!selItem) return;
      const shapes = selItem.shapes || [];
      const constraints = selItem.constraints || [];
      const sel = useStore.getState().selectedSketchElement;
      const indices =
        multiSelectedIndices.length > 0
          ? [...multiSelectedIndices]
          : sel?.type === "line"
            ? [sel.shapeIdx]
            : [];
      if (indices.length === 0) return;
      e.preventDefault();
      const indexSet = new Set(indices);
      const idxMap = new Map(indices.map((origIdx, i) => [origIdx, i]));
      sketchClipboard = {
        shapes: indices.map((i) => shapes[i]).filter(Boolean),
        constraints: constraints
          .filter(
            (c) =>
              c.type === "coincident" &&
              indexSet.has(c.shapeAIdx) &&
              indexSet.has(c.shapeBIdx),
          )
          .map((c) => ({
            ...c,
            shapeAIdx: idxMap.get(c.shapeAIdx),
            shapeBIdx: idxMap.get(c.shapeBIdx),
          })),
      };
      return;
    }

    if (
      sketchModeRef.current &&
      (isMac ? e.metaKey : e.ctrlKey) &&
      e.key === "v"
    ) {
      if (!sketchClipboard) return;
      const selItem = itemsRef.current.find(
        (i) => i.id === selectedIdRef.current,
      );
      if (!selItem) return;
      e.preventDefault();
      const baseIdx = (selItem.shapes || []).length;
      const PASTE_OFFSET = 0.5;
      const newShapes = sketchClipboard.shapes
        .map((s) => translateShape(s, PASTE_OFFSET, PASTE_OFFSET))
        .filter(Boolean);
      const newConstraints = sketchClipboard.constraints.map((c) => ({
        ...c,
        shapeAIdx: c.shapeAIdx + baseIdx,
        shapeBIdx: c.shapeBIdx + baseIdx,
      }));
      useStore
        .getState()
        .addSketchShapes(selectedIdRef.current, newShapes, newConstraints);
      return;
    }

    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      sketchModeRef.current
    ) {
      if (selectedConstraintIdx !== null) {
        e.preventDefault();
        useStore
          .getState()
          .deleteSketchConstraint(selectedIdRef.current, selectedConstraintIdx);
        clearConstraintSelection();
        return;
      }
      const sel = useStore.getState().selectedSketchElement;
      const toDelete =
        multiSelectedIndices.length > 0
          ? [...multiSelectedIndices]
          : sel?.type === "line"
            ? [sel.shapeIdx]
            : null;
      if (toDelete?.length > 0) {
        e.preventDefault();
        useStore.getState().deleteSketchShapes(selectedIdRef.current, toDelete);
        clearMultiSelectOverlays();
        multiSelectedIndices = [];
        clearSketchSelection();
      }
      return;
    }

    if (e.key === "Escape") {
      if (selectedConstraintIdx !== null) {
        clearConstraintSelection();
        return;
      }
      if (extrudeSelectModeRef && extrudeSelectModeRef.current) {
        cancelExtrude();
        return;
      }
      if (sketchPlacementModeRef.current) {
        useStore.getState().setSketchPlacementMode(false);
        return;
      }
      if (sketchModeRef.current) {
        const store = useStore.getState();
        if (store.sketchModifyMode) {
          store.setSketchModifyMode(null);
          clearModifyPreview();
          return;
        }
        if (store.sketchConstraintMode || store.sketchDistanceInput) {
          store.setSketchConstraintMode(null);
          store.setSketchConstraintFirstPoint(null);
          store.setSketchDistanceInput(null);
          clearCoincidentFirstOverlay();
          return;
        }
        if (sketchDrawRef.current) {
          cancelSketchDraw();
        } else {
          useStore.getState().setActiveSketchTool(null);
          clearSketchSelection();
          clearMarqueeRect();
          marqueeStartScreen = null;
          marqueeActive = false;
        }
        return;
      }
    }

    if (sketchModeRef.current && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key.toLowerCase() === "d") {
        e.preventDefault();
        const store = useStore.getState();
        const isActive = store.sketchConstraintMode === "distance";
        store.setSketchConstraintMode(isActive ? null : "distance");
        store.setSketchConstraintFirstPoint(null);
        store.setSketchDistanceInput(null);
        clearCoincidentFirstOverlay();
        return;
      }
      const toolMap = { l: "line", r: "rect", a: "arc", b: "bezier" };
      const tool = toolMap[e.key.toLowerCase()];
      if (tool) {
        e.preventDefault();
        if (sketchDrawRef.current) cancelSketchDraw();
        const current = useStore.getState().activeSketchTool;
        useStore.getState().setActiveSketchTool(current === tool ? null : tool);
      }
    }
  };

  // ── Animate loop ───────────────────────────────────────────────────────────

  let animId;
  const animate = () => {
    animId = requestAnimationFrame(animate);

    if (cameraAnimRef.current) {
      const anim = cameraAnimRef.current;
      const t = Math.min(1, (Date.now() - anim.startTime) / anim.duration);
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      cameraRef.current.position.lerpVectors(anim.startPos, anim.endPos, ease);
      targetRef.current.lerpVectors(anim.startTarget, anim.endTarget, ease);
      cameraRef.current.up
        .lerpVectors(anim.startUp, anim.endUp, ease)
        .normalize();
      cameraRef.current.lookAt(targetRef.current);
      setRotationState(cameraRef.current.quaternion.clone());
      if (t >= 1) {
        if (anim.onComplete) anim.onComplete();
        cameraAnimRef.current = null;
      }
    }

    if (sketchModeRef.current && sketchGridGroupRef?.current) {
      const minorGrid = sketchGridGroupRef.current.userData.minorGrid;
      const sketchMesh = objectsRef.current[selectedIdRef.current];
      if (minorGrid && sketchMesh) {
        const inv = sketchMesh.quaternion.clone().invert();
        const local = targetRef.current
          .clone()
          .sub(sketchMesh.position)
          .applyQuaternion(inv);
        minorGrid.position.set(Math.round(local.x), Math.round(local.y), 0);
      }
    }

    gridMaterial.uniforms.uCameraPos.value.copy(cameraRef.current.position);
    if (composerRef.current) composerRef.current.render();
    else renderer.render(scene, cameraRef.current);
  };
  animate();

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
    cancelAnimationFrame(animId);
    clearTimeout(shiftScrollSessionTimer);
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
  };
}
