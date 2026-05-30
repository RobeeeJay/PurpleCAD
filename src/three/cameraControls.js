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
import {
  resolveItemDepth,
  resolveConstraintDistance,
  formatAsFormula,
} from "./geometryParams.js";
import { createHighlightHelpers } from "./cameraControls/highlights.js";
import { createExtrudeHelpers } from "./cameraControls/extrude.js";
import { createAnimateLoop } from "./cameraControls/animateLoop.js";
import { createSketchModifyHelpers } from "./cameraControls/sketchModify.js";
import { createSketchConstraintHandlers } from "./cameraControls/sketchConstraintHandlers.js";
import { createSketchDrawHelpers } from "./cameraControls/sketchDraw.js";
import { createSnapHelpers } from "./cameraControls/snap.js";
import { createSketchHoverHelpers } from "./cameraControls/sketchHover.js";
import { rotationQuaternionForDrag } from "./cameraControls/rotationHandle.js";

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

  // ── Sketch element selection + coincident constraints ─────────────────────
  let sketchSelectionOverlay = null;
  let coincidentFirstOverlay = null;
  // Setter exposed to extracted modules that need to swap the ring overlay
  // mesh (they can't reassign the closure-local `let` directly).
  const setCoincidentFirstOverlay = (o) => {
    coincidentFirstOverlay = o;
  };
  let multiSelectedIndices = [];
  let multiSelectOverlays = [];
  let marqueeStartScreen = null;
  let marqueeActive = false;
  let marqueeRectObj = null;
  let lastClickTime = 0;
  let lastClickX = 0;
  let lastClickY = 0;
  let sketchClipboard = null; // { shapes: [...], constraints: [...] }
  let longPressTimer = null;
  let longPressMenuOpen = false;

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

  // Exposed on cameraControlsRef so SketchOverlays can drive hover/select for
  // the long-press context menu without duplicating these highlight functions.
  controls.highlightForMenu = (item) => {
    clearHoverLineHighlight();
    clearHoverPointIndicator();
    clearConstraintHoverHighlight();
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    if (item.kind === "point") {
      showHoverPointIndicator({ x: item.localX, y: item.localY }, sketchMesh);
    } else if (item.kind === "line") {
      const g = sketchShapesGroupRef?.current;
      if (g) {
        const lineObj = g.children.find(
          (c) =>
            c.userData.shapeIdx === item.shapeIdx &&
            !c.userData.isConstraintObj &&
            c.material?.color,
        );
        if (lineObj) applyHoverLineHighlight(lineObj);
      }
    } else if (item.kind === "constraint") {
      applyConstraintHoverHighlight(item.shapeIndices, item.constraintColor);
    }
  };
  controls.clearMenuHighlight = () => {
    clearHoverLineHighlight();
    clearHoverPointIndicator();
    clearConstraintHoverHighlight();
  };
  controls.selectMenuItem = (item) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    clearAllSketchHover();
    if (item.kind === "point") {
      sketchSelectPoint(
        {
          x: item.localX,
          y: item.localY,
          shapeIdx: item.shapeIdx,
          pointKey: item.pointKey,
        },
        sketchMesh,
      );
    } else if (item.kind === "line") {
      const shape = (selItem.shapes || [])[item.shapeIdx];
      if (shape) sketchSelectLine(item.shapeIdx, shape, sketchMesh);
    } else if (item.kind === "constraint") {
      selectConstraint(item.constraintIdx);
    }
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
    buildExtrudePreviewMesh,
    handleExtrudeHover,
    handleExtrudeProfileClick,
    handleExtrudeDepthMove,
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
  controls.finalizeExtrudeWithDepth = (depth) =>
    finalizeExtrude(null, null, depth);
  controls.finalizeExtrudeWithFormula = (formula, depth) =>
    finalizeExtrude(null, null, depth, formula);
  controls.cancelExtrude = () => cancelExtrude();
  controls.updateExtrudePreview = (depth) => {
    if (!extrude.extrudeProfileData) return;
    const d = Math.max(0.05, depth);
    buildExtrudePreviewMesh(extrude.extrudeProfileData, d);
  };

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

  // ── Chamfer / Bevel helpers ───────────────────────────────────────────────
  const sketchModify = createSketchModifyHelpers(
    { scene, renderer, objectsRef, itemsRef, selectedIdRef },
    { findSnap, propagateConstraints },
  );
  const { clearModifyPreview, applyModify, showModifyPreview } = sketchModify;

  // ── Sketch constraint click handlers (distance / coincident / on-line) ────
  const sketchConstraints = createSketchConstraintHandlers(
    {
      scene,
      renderer,
      cameraRef,
      objectsRef,
      itemsRef,
      selectedIdRef,
      sketchShapesGroupRef,
    },
    {
      findSnap,
      hitTestSketchLines,
      makeRay,
      propagateConstraints,
      makeRingOverlay,
      clearCoincidentFirstOverlay,
      clearSketchSelection,
      setCoincidentFirstOverlay,
    },
  );
  const { handleDistanceConstraintClick, handleCoincidentClick } =
    sketchConstraints;

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
        reapplyConstraintSelectionVisual();
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

  const SHAPE_TYPE_LABELS = {
    line: "Line",
    circle: "Circle",
    arc: "Arc",
    ellipse: "Ellipse",
    bezier: "Bezier",
    rect: "Rect",
  };
  const CONSTRAINT_TYPE_LABELS = {
    coincident: "Coincident",
    distance: "Distance",
    onLine: "On Line",
    horizontal: "Horizontal",
    vertical: "Vertical",
    angle: "Angle",
  };

  const buildLongPressItems = (screenX, screenY) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return [];
    const shapes = selItem.shapes || [];
    const result = [];
    const rect = renderer.domElement.getBoundingClientRect();

    // Points within 20px
    const snapPts = getSnapPoints(shapes);
    for (const pt of snapPts) {
      const world = new THREE.Vector3(pt.x, pt.y, 0.003)
        .applyQuaternion(sketchMesh.quaternion)
        .add(sketchMesh.position);
      const ndc = world.clone().project(cameraRef.current);
      const sx = ((ndc.x + 1) / 2) * rect.width + rect.left;
      const sy = ((-ndc.y + 1) / 2) * rect.height + rect.top;
      if (Math.hypot(screenX - sx, screenY - sy) < 20) {
        const shapeLabel =
          SHAPE_TYPE_LABELS[shapes[pt.shapeIdx]?.type] ?? "Shape";
        result.push({
          kind: "point",
          label: `${shapeLabel} ${pt.shapeIdx} — ${pt.pointKey}`,
          shapeIdx: pt.shapeIdx,
          pointKey: pt.pointKey,
          localX: pt.x,
          localY: pt.y,
        });
      }
    }

    // Lines via raycaster
    const sketchGroup = sketchShapesGroupRef?.current;
    if (sketchGroup) {
      const nx = ((screenX - rect.left) / rect.width) * 2 - 1;
      const ny = -((screenY - rect.top) / rect.height) * 2 + 1;
      const ray = new THREE.Raycaster();
      ray.setFromCamera({ x: nx, y: ny }, cameraRef.current);
      const lineObjs = sketchGroup.children.filter(
        (c) => c.userData.shapeIdx != null,
      );
      const hits = hitTestSketchLines(ray, lineObjs);
      for (const hit of hits) {
        const shapeIdx = hit.object.userData.shapeIdx;
        if (shapeIdx == null) continue;
        if (result.some((i) => i.kind === "line" && i.shapeIdx === shapeIdx))
          continue;
        const shape = shapes[shapeIdx];
        if (!shape) continue;
        result.push({
          kind: "line",
          label: `${SHAPE_TYPE_LABELS[shape.type] ?? "Shape"} ${shapeIdx}`,
          shapeIdx,
        });
      }
    }

    // Constraint icons within 20px
    const seenConstraints = new Set();
    if (sketchGroup) {
      for (const cObj of sketchGroup.children) {
        if (!cObj.userData.isConstraint) continue;
        const ci = cObj.userData.constraintIdx;
        if (seenConstraints.has(ci)) continue;
        const lp = cObj.userData.constraintIconLocalPos;
        if (!lp) continue;
        const worldPt = new THREE.Vector3(lp.x, lp.y, 0.005)
          .applyQuaternion(sketchMesh.quaternion)
          .add(sketchMesh.position);
        const ndc = worldPt.clone().project(cameraRef.current);
        const sx = ((ndc.x + 1) / 2) * rect.width + rect.left;
        const sy = ((-ndc.y + 1) / 2) * rect.height + rect.top;
        if (Math.hypot(screenX - sx, screenY - sy) < 20) {
          seenConstraints.add(ci);
          result.push({
            kind: "constraint",
            label:
              CONSTRAINT_TYPE_LABELS[cObj.userData.constraintType] ??
              cObj.userData.constraintType,
            constraintIdx: ci,
            constraintType: cObj.userData.constraintType,
            shapeIndices: cObj.userData.constraintShapeIndices,
            constraintColor: cObj.userData.constraintColor,
          });
        }
      }
    }

    return result;
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

  // ── Active sketch tool: preview + click commit ────────────────────────────
  const sketchDraw = createSketchDrawHelpers(
    {
      scene,
      renderer,
      objectsRef,
      itemsRef,
      selectedIdRef,
      sketchDrawRef,
      activeSketchToolRef,
      dimHintRef,
    },
    {
      screenToSketchLocal,
      findSnap,
      showSnapIndicator,
      clearSnapIndicator,
      clearSketchPreview,
      clearHoverFills,
      makePreviewLine2,
      setSketchDrawPhase,
    },
  );
  const { updateSketchPreview, handleSketchClick } = sketchDraw;

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
          const downX = e.clientX,
            downY = e.clientY;
          longPressTimer = setTimeout(() => {
            longPressTimer = null;
            const items = buildLongPressItems(downX, downY);
            if (items.length > 0) {
              sketchDrag = null;
              renderer.domElement.style.cursor = "";
              longPressMenuOpen = true;
              useStore
                .getState()
                .setSketchLongPressMenu({ x: downX, y: downY, items });
            }
          }, 500);
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
      if (longPressTimer) {
        const ddx = e.clientX - (controls.mouseDownX ?? e.clientX);
        const ddy = e.clientY - (controls.mouseDownY ?? e.clientY);
        if (Math.hypot(ddx, ddy) >= 5) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }
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
          // See cameraControls/rotationHandle.js for the per-axis sign
          // convention.  Rotates around the WORLD axis the handle
          // represents (premultiplied with the orientation captured at
          // drag start) so each handle stays decoupled from any other
          // axis the object is already rotated on.
          const newQuat = rotationQuaternionForDrag(
            drag.handleType,
            drag.startParentQuaternion,
            dxPx,
          );
          if (newQuat) mesh.quaternion.copy(newQuat);
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
      // Modifier-key scheme:
      //   • CTRL (Cmd on Mac)        → edge selection mode
      //   • ALT                      → face selection mode
      //   • CTRL + ALT               → point selection mode
      //   • SHIFT (orthogonal)       → additive selection in any of the
      //                                above modes (incl. plain object mode).
      const cmdOrCtrl = isMac ? e.metaKey : e.ctrlKey;
      const edgeMode = cmdOrCtrl && !e.altKey;
      const faceMode = !cmdOrCtrl && e.altKey;
      const pointMode = cmdOrCtrl && e.altKey;

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
      clearTimeout(longPressTimer);
      longPressTimer = null;
      if (longPressMenuOpen) {
        longPressMenuOpen = false;
        useStore.getState().setSketchLongPressMenu(null);
        sketchDrag = null;
        renderer.domElement.style.cursor = "";
        marqueeStartScreen = null;
        marqueeActive = false;
        return;
      }
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
                    // Preserve the raw distance (string formula or legacy
                    // number) so the input shows what the user typed.
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

        // Record the transform to history IMMEDIATELY at drag commit
        // rather than via an 800ms debounce.  The debounced version had
        // a race: setItemTransform updates items[] live, but until the
        // debounce fires history is stale.  Any history-replaying action
        // (eg. addItem → replayUpTo) inside that 800ms window would
        // rebuild items from the stale history and the dragged object
        // would snap back to its pre-drag position.  recordTransformHistory's
        // own merge-in-place logic already coalesces successive transforms
        // on the same item, so the debounce wasn't needed for coalescing.
        if (transformDebounceRef.current) {
          clearTimeout(transformDebounceRef.current);
          transformDebounceRef.current = null;
        }
        const label = drag.handleType.startsWith("rot")
          ? "Rotated"
          : drag.handleType === "scale"
            ? "Scaled"
            : "Moved";
        useStore.getState().recordTransformHistory(drag.itemId, label);
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
          let hostSolidId = null;
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
            // Remember which solid this sketch was placed on so a later
            // cut-extrude from the sketch's loops targets only that
            // solid.  Without this, sketch-loop cuts fall back to
            // "every visible non-sketch solid", which silently turns
            // unrelated primitives into csg items at the same world
            // position (the visible appearance changes from analytic
            // shader to tessellated mesh — the user perceives this as
            // the cut having a wrong origin).
            hostSolidId = hit.object.userData?.itemId ?? null;
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
                // The placement-plane meshes are drawn at the current
                // camera target so they stay visible to the user, but the
                // canonical XZ/XY/YZ planes themselves pass through the
                // world origin.  Zero out the axis perpendicular to the
                // selected plane so a sketch created on (e.g.) XZ lands
                // at world Y=0 rather than wherever the camera happened
                // to be focused (often on top of the most recent solid).
                const onAxis = { x: hp.x, y: hp.y, z: hp.z };
                if (hitPlane.name === "XZ") onAxis.y = 0;
                else if (hitPlane.name === "XY") onAxis.z = 0;
                else if (hitPlane.name === "YZ") onAxis.x = 0;
                position = onAxis;
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
              hostSolidId,
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
      // Modifier-key scheme (must match the hover branch above):
      //   • CTRL/Cmd            → edge selection mode
      //   • ALT                 → face selection mode
      //   • CTRL/Cmd + ALT      → point selection mode (hover only)
      //   • SHIFT (orthogonal)  → additive: append/toggle within the
      //                           existing selection of the current mode.
      const cmdOrCtrl3d = isMac ? e.metaKey : e.ctrlKey;
      const edgeMode3d = cmdOrCtrl3d && !e.altKey;
      const faceMode3d = !cmdOrCtrl3d && e.altKey;
      if (intersects.length > 0) {
        const clickedId = intersects[0].object.userData.itemId || null;
        if (
          faceMode3d &&
          highlights.pendingFaceSelection &&
          highlights.pendingFaceSelection.itemId === clickedId
        ) {
          // Alt+click in face mode: commit face to sub-geometry selection.
          // Faces and edges are mutually exclusive — always clear edges.
          // With shift held, keep any existing face selection on this item
          // and toggle the clicked face; without shift, replace it.
          const prev = useStore.getState().selectedSubGeometry;
          const faces =
            e.shiftKey && prev?.itemId === clickedId && prev.edges.length === 0
              ? [...prev.faces]
              : [];
          const n = highlights.pendingFaceSelection;
          // Two stored faces are "the same" if BOTH the normal and the
          // centroid sample point are close — normal alone can't
          // distinguish coplanar disconnected faces.
          const sameFace = (f) =>
            Math.abs(f.nx - n.nx) < 0.01 &&
            Math.abs(f.ny - n.ny) < 0.01 &&
            Math.abs(f.nz - n.nz) < 0.01 &&
            (f.cx == null ||
              n.cx == null ||
              (Math.abs(f.cx - n.cx) < 0.05 &&
                Math.abs(f.cy - n.cy) < 0.05 &&
                Math.abs(f.cz - n.cz) < 0.05));
          const already = faces.some(sameFace);
          useStore.getState().setSelectedSubGeometry({
            itemId: clickedId,
            edges: [],
            faces: already
              ? faces.filter((f) => !sameFace(f))
              : [
                  ...faces,
                  {
                    nx: n.nx,
                    ny: n.ny,
                    nz: n.nz,
                    ...(n.cx != null ? { cx: n.cx, cy: n.cy, cz: n.cz } : null),
                  },
                ],
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
          edgeMode3d &&
          highlights.pendingEdgeSelection &&
          highlights.pendingEdgeSelection.itemId === clickedId
        ) {
          // Ctrl/Cmd+click in edge mode: commit edge to sub-geometry
          // selection.  Edges and faces are mutually exclusive — always
          // clear faces.  Shift extends the prior edge selection.
          const prev = useStore.getState().selectedSubGeometry;
          const edges =
            e.shiftKey && prev?.itemId === clickedId && prev.faces.length === 0
              ? [...prev.edges]
              : [];
          const ed = highlights.pendingEdgeSelection;
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
          // Normal (object-mode) click: shift adds to multi-object selection.
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
      const selConstraintIdx = getSelectedConstraintIdx();
      if (selConstraintIdx !== null) {
        e.preventDefault();
        useStore
          .getState()
          .deleteSketchConstraint(selectedIdRef.current, selConstraintIdx);
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
      if (longPressMenuOpen) {
        longPressMenuOpen = false;
        useStore.getState().setSketchLongPressMenu(null);
        return;
      }
      if (getSelectedConstraintIdx() !== null) {
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

  const animateLoop = createAnimateLoop({
    scene,
    renderer,
    cameraRef,
    targetRef,
    cameraAnimRef,
    sketchModeRef,
    sketchGridGroupRef,
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
