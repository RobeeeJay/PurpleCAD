// Sketch hover + constraint-selection visuals: line-hover highlight, snap-point
// hover ring, constraint-icon hover highlight, and click-to-select-constraint
// state (with the dimension-hint tooltip).  Owns all the transient highlight
// state; the event handlers drive it via the returned methods.  Split out of
// cameraControls.js.

import * as THREE from "three";
import { useStore } from "../../store";

// Walk the chain of connected straight lines that continue smoothly through
// `startIdx` — at each shared endpoint, follow the connected line whose bend
// (turn angle) is within `maxAngleDeg`, in both directions.  Used so hovering
// one segment of a many-segment curve highlights the whole curve.
export function computeLineChain(shapes, startIdx, maxAngleDeg) {
  const start = shapes?.[startIdx];
  if (!start || start.type !== "line") return [startIdx];
  const maxAngle = (Math.max(0, maxAngleDeg) * Math.PI) / 180;
  const EPS = 1e-4;
  const close = (ax, ay, bx, by) =>
    Math.abs(ax - bx) < EPS && Math.abs(ay - by) < EPS;
  const visited = new Set([startIdx]);
  const chain = [startIdx];

  // From the endpoint (ex,ey), with the chain currently travelling in unit
  // direction (dx,dy), greedily extend along the smoothest connected line.
  const walk = (ex, ey, dx, dy) => {
    let curEx = ex,
      curEy = ey,
      curDx = dx,
      curDy = dy;
    for (;;) {
      let best = null;
      let bestAngle = Infinity;
      for (let i = 0; i < shapes.length; i++) {
        if (visited.has(i)) continue;
        const s = shapes[i];
        if (!s || s.type !== "line") continue;
        let ox, oy;
        if (close(s.x1, s.y1, curEx, curEy)) {
          ox = s.x2;
          oy = s.y2;
        } else if (close(s.x2, s.y2, curEx, curEy)) {
          ox = s.x1;
          oy = s.y1;
        } else continue;
        let lx = ox - curEx,
          ly = oy - curEy;
        const len = Math.hypot(lx, ly);
        if (len < EPS) continue;
        lx /= len;
        ly /= len;
        const dot = Math.max(-1, Math.min(1, curDx * lx + curDy * ly));
        const angle = Math.acos(dot);
        if (angle < bestAngle) {
          bestAngle = angle;
          best = { i, ox, oy, lx, ly };
        }
      }
      if (!best || bestAngle > maxAngle) break;
      visited.add(best.i);
      chain.push(best.i);
      curEx = best.ox;
      curEy = best.oy;
      curDx = best.lx;
      curDy = best.ly;
    }
  };

  const dForward = Math.hypot(start.x2 - start.x1, start.y2 - start.y1) || 1;
  walk(
    start.x2,
    start.y2,
    (start.x2 - start.x1) / dForward,
    (start.y2 - start.y1) / dForward,
  );
  walk(
    start.x1,
    start.y1,
    (start.x1 - start.x2) / dForward,
    (start.y1 - start.y2) / dForward,
  );
  return chain;
}

export function createSketchHoverHelpers(
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
) {
  // ── Sketch element hover highlights ──────────────────────────────────────
  // A hover highlight can cover a CHAIN of connected lines (curve detection),
  // so track a list of { lineObj, origColor } rather than a single line.
  let hoveredSketchLineRefs = [];
  let hoveredSketchLineColor = null;

  const clearHoverLineHighlight = () => {
    hoveredSketchLineRefs.forEach(({ lineObj, origColor }) => {
      if (lineObj.material?.color) lineObj.material.color.setHex(origColor);
    });
    hoveredSketchLineRefs = [];
    hoveredSketchLineColor = null;
  };

  const applyHoverLineHighlights = (lineObjs, color = 0xbbddff) => {
    const objs = lineObjs.filter((o) => o?.material?.color);
    // No-op if the exact same set + colour is already highlighted (so moving
    // within one chain doesn't churn the materials every pointer move).
    const cur = new Set(hoveredSketchLineRefs.map((r) => r.lineObj.uuid));
    if (
      hoveredSketchLineColor === color &&
      objs.length === cur.size &&
      objs.every((o) => cur.has(o.uuid))
    )
      return;
    clearHoverLineHighlight();
    objs.forEach((lineObj) => {
      hoveredSketchLineRefs.push({
        lineObj,
        origColor: lineObj.material.color.getHex(),
      });
      lineObj.material.color.setHex(color);
    });
    hoveredSketchLineColor = color;
  };

  // Highlight the smooth chain of connected lines through `startShapeIdx`.
  const applyHoverLineChainHighlight = (
    startShapeIdx,
    shapes,
    sketchGroup,
    color = 0xbbddff,
  ) => {
    const maxAngle = useStore.getState().curveDetectionAngleDeg ?? 5;
    const chainIdx = computeLineChain(shapes || [], startShapeIdx, maxAngle);
    const objs = chainIdx
      .map((idx) =>
        sketchGroup?.children.find(
          (c) =>
            c.userData.shapeIdx === idx &&
            !c.userData.isConstraintObj &&
            c.material?.color,
        ),
      )
      .filter(Boolean);
    applyHoverLineHighlights(objs, color);
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
      angle: 0xff66cc,
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

  // 0xffaa33 (amber) marks the line a hovered POINT belongs to, distinct from
  // the 0xbbddff line-body hover so the two reads don't blur together.
  const POINT_LINE_COLOR = 0xffaa33;
  const applyHoverLineHighlight = (lineObj, color = 0xbbddff) =>
    applyHoverLineHighlights([lineObj], color);

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

    // Hover priority: points / circle centers first, then lines, then
    // constraint icons.  Snap points (endpoints + circle/arc/ellipse centres)
    // are the smallest targets and the ones a user reaches for most, so they
    // win even when a constraint icon or line sits under the same cursor.
    const sketchGroup = sketchShapesGroupRef?.current;

    // ── Point / circle-center hover (highest priority) ───────────────────────
    const snap = findSnap(screenX, screenY, selItem?.shapes || [], sketchMesh);
    if (snap) {
      showHoverPointIndicator(snap, sketchMesh);
      // Also highlight the line this point belongs to, in the distinct amber
      // colour, so it's clear which segment the endpoint drives.
      const ownerLine = sketchGroup?.children.find(
        (c) => c.userData.shapeIdx === snap.shapeIdx && c.material?.color,
      );
      if (ownerLine) applyHoverLineHighlight(ownerLine, POINT_LINE_COLOR);
      else clearHoverLineHighlight();
      clearConstraintHoverHighlight();
      if (dimHintRef.current) dimHintRef.current.style.display = "none";
      renderer.domElement.style.cursor = "grab";
      return;
    }
    clearHoverPointIndicator();

    // ── Line hover (second priority) ─────────────────────────────────────────
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
        applyHoverLineChainHighlight(
          hits[0].object.userData.shapeIdx,
          selItem?.shapes || [],
          sketchGroup,
        );
        clearConstraintHoverHighlight();
        if (dimHintRef.current) dimHintRef.current.style.display = "none";
        renderer.domElement.style.cursor = "grab";
        return;
      }
    }
    clearHoverLineHighlight();

    // ── Constraint icon hover (lowest priority) ──────────────────────────────
    const CONSTRAINT_HIT_PX = 14;
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
          renderer.domElement.style.cursor = "default";
          if (dimHintRef.current) {
            const CONSTRAINT_LABELS = {
              coincident: "Coincident",
              distance: "Distance",
              onLine: "On Line",
              horizontal: "Horizontal",
              vertical: "Vertical",
              angle: "Angle",
            };
            const tipRect = renderer.domElement.getBoundingClientRect();
            dimHintRef.current.textContent =
              CONSTRAINT_LABELS[cObj.userData.constraintType] ??
              cObj.userData.constraintType;
            dimHintRef.current.style.display = "block";
            dimHintRef.current.style.left = `${screenX - tipRect.left + 16}px`;
            dimHintRef.current.style.top = `${screenY - tipRect.top - 10}px`;
          }
          return;
        }
      }
    }
    clearConstraintHoverHighlight();
    if (dimHintRef.current) dimHintRef.current.style.display = "none";
    renderer.domElement.style.cursor = "";
  };

  const clearAllSketchHover = () => {
    clearHoverLineHighlight();
    clearHoverPointIndicator();
    clearConstraintHoverHighlight();
    renderer.domElement.style.cursor = "";
  };

  const getSelectedConstraintIdx = () => selectedConstraintIdx;
  const reapplyConstraintSelectionVisual = () => {
    selectedConstraintLineRefs = [];
    applyConstraintSelectionVisual();
  };

  return {
    clearHoverLineHighlight,
    applyHoverLineHighlight,
    applyHoverLineChainHighlight,
    clearConstraintSelection,
    applyConstraintSelectionVisual,
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
  };
}
