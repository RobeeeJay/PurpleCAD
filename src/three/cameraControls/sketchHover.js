// Sketch hover + constraint-selection visuals: line-hover highlight, snap-point
// hover ring, constraint-icon hover highlight, and click-to-select-constraint
// state (with the dimension-hint tooltip).  Owns all the transient highlight
// state; the event handlers drive it via the returned methods.  Split out of
// cameraControls.js.

import * as THREE from "three";
import { useStore } from "../../store";
import {
  SKETCH_HOVER_LINE_COLOR,
  SKETCH_HOVER_POINT_LINE_COLOR,
  SKETCH_PIVOT_COLOR,
  sketchLineColorFor,
  sketchSelectedColorFor,
} from "../theme.js";
import {
  nearestConstraintMarker,
  setConstraintIconSelected,
} from "../sceneObjects/constraintIconSprites.js";

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
  let hoveredSketchLine = null;
  let hoveredSketchLineOrigColor = null;
  let hoveredSketchLineColor = null;

  const clearHoverLineHighlight = () => {
    if (hoveredSketchLine) {
      hoveredSketchLine.material.color.setHex(
        hoveredSketchLineOrigColor ??
          sketchLineColorFor(useStore.getState().theme),
      );
      hoveredSketchLine = null;
      hoveredSketchLineOrigColor = null;
      hoveredSketchLineColor = null;
    }
  };

  // ── Constraint icon hover highlights ─────────────────────────────────────
  let hoveredConstraintLines = []; // [{ lineObj, origColor }]
  let selectedConstraintIdx = null;
  let selectedConstraintLineRefs = []; // [{ lineObj, origColor }]
  let selectedConstraintIconRefs = []; // [{ obj, origColor }]

  const clearConstraintSelection = () => {
    selectedConstraintLineRefs.forEach(({ lineObj, origColor }) => {
      if (lineObj.material?.color) lineObj.material.color.setHex(origColor);
    });
    selectedConstraintLineRefs = [];
    // Restore each recolored icon to the EXACT colour it had when selected —
    // recomputing from the type loses the mirror / pattern colours (and the
    // grey dimension-line colour), which made deselected pattern icons vanish.
    selectedConstraintIconRefs.forEach(({ obj, origColor, icon }) => {
      if (icon) setConstraintIconSelected(obj, false);
      else if (obj.material?.color) obj.material.color.setHex(origColor);
    });
    selectedConstraintIconRefs = [];
    selectedConstraintIdx = null;
    useStore.getState().setSelectedSketchConstraintIdx(null);
  };

  const applyConstraintSelectionVisual = () => {
    if (selectedConstraintIdx === null) return;
    const g = sketchShapesGroupRef?.current;
    if (!g) return;
    for (const o of g.children) {
      // A toolbar-icon marker shows selection on its backing plate; tinting
      // the sprite would muddy the artwork.
      if (
        o.userData.screenIcon &&
        o.userData.constraintIdx === selectedConstraintIdx
      ) {
        selectedConstraintIconRefs.push({ obj: o, icon: true });
        setConstraintIconSelected(o, true);
        continue;
      }
      if (
        o.userData.isConstraintObj &&
        o.userData.constraintIdx === selectedConstraintIdx &&
        o.material?.color &&
        !o.isSprite
      ) {
        selectedConstraintIconRefs.push({
          obj: o,
          origColor: o.material.color.getHex(),
        });
        o.material.color.setHex(
          sketchSelectedColorFor(useStore.getState().theme),
        );
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
      lineObj.material.color.setHex(
        sketchSelectedColorFor(useStore.getState().theme),
      );
    });
  };

  const selectConstraint = (constraintIdx) => {
    const isSame = selectedConstraintIdx === constraintIdx;
    clearConstraintSelection();
    if (!isSame) {
      selectedConstraintIdx = constraintIdx;
      useStore.getState().setSelectedSketchConstraintIdx(constraintIdx);
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

  const applyHoverLineHighlight = (
    lineObj,
    color = SKETCH_HOVER_LINE_COLOR,
  ) => {
    if (hoveredSketchLine === lineObj && hoveredSketchLineColor === color)
      return;
    clearHoverLineHighlight();
    hoveredSketchLineOrigColor = lineObj.material.color.getHex();
    lineObj.material.color.setHex(color);
    hoveredSketchLine = lineObj;
    hoveredSketchLineColor = color;
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
      color: SKETCH_PIVOT_COLOR,
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
      if (ownerLine)
        applyHoverLineHighlight(ownerLine, SKETCH_HOVER_POINT_LINE_COLOR);
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
        applyHoverLineHighlight(hits[0].object);
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
      const cObj = nearestConstraintMarker(
        sketchGroup.children,
        sketchMesh,
        cameraRef.current,
        rect,
        screenX,
        screenY,
        CONSTRAINT_HIT_PX,
      );
      if (cObj) {
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
            centre: "Centre (double-click to edit)",
            cog: "Cog (double-click to edit)",
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
  };
}
