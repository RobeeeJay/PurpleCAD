// Sketch-mode click resolution: what a plain (non-drag) pointer-up does in
// the selection state.  In priority order — apply the active modify (chamfer/
// bevel) tool, route to the active constraint tool (coincident / distance /
// midpoint), else a double-click re-opens the value/tool behind a constraint
// icon (distance / offset / pattern / mirror / text) or a chamfer-bevel
// bridge, or coincident-connected-line select; a shift-click toggles the hit
// element in the multi-selection; a chamfer value-label click re-opens resize;
// a constraint-icon click selects it; otherwise a normal single-element
// select.  Split out of the (previously ~450-line) onSketchMouseUp.

import * as THREE from "three";
import { useStore } from "../../store";
import { MM_PER_UNIT } from "../sceneObjects.js";
import { collectConnectedShapes } from "../sketchGeometry.js";
import { effectiveSketchSelTypes } from "../../store/selectionMode.js";
import { nearestConstraintMarker } from "../sceneObjects/constraintIconSprites.js";

// Constraints whose marker re-opens an editor on double-click.
const EDITABLE_CONSTRAINTS = new Set([
  "distance",
  "pointLineDistance",
  "offset",
  "rectangularPattern",
  "mirror",
  "circularPattern",
  "centre",
  "text",
]);

export function createSketchClickHandler(
  {
    renderer,
    cameraRef,
    itemsRef,
    selectedIdRef,
    objectsRef,
    sketchShapesGroupRef,
    multiSelectedRef,
  },
  {
    makeRay,
    hitTestSketchLines,
    findSnap,
    applyModify,
    handleCoincidentClick,
    handleDistanceConstraintClick,
    handleMidpointClick,
    clearMultiSelectOverlays,
    showMultiSelectOverlays,
    selectConstraint,
    clearConstraintSelection,
    trySelectSketchElement,
  },
) {
  // Double-click tracking (time + position of the previous click).
  let lastClickTime = 0;
  let lastClickX = 0;
  let lastClickY = 0;

  const doClick = (sx, sy, shift = false) => {
    const constraintMode = useStore.getState().sketchConstraintMode;
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
    if (constraintMode === "midpoint") {
      handleMidpointClick(sx, sy);
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
        const cObj = nearestConstraintMarker(
          dblG.children,
          dblMesh,
          cameraRef.current,
          rect2,
          sx,
          sy,
          18,
          (o) => EDITABLE_CONSTRAINTS.has(o.userData.constraintType),
        );
        if (cObj) {
          const c = (dblSel.constraints || [])[cObj.userData.constraintIdx];
          if (c && c.type === "pointLineDistance") {
            useStore.getState().setSketchDistanceInput({
              pointLine: {
                pointShapeIdx: c.pointShapeIdx,
                pointKey: c.pointKey,
                lineShapeIdx: c.lineShapeIdx,
              },
              defaultDistance: c.distance,
              constraintIdx: cObj.userData.constraintIdx,
            });
            useStore.getState().setSketchConstraintMode("distance");
          } else if (c && c.type === "distance") {
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
          } else if (c && c.type === "offset") {
            useStore.getState().setSketchDistanceInput({
              offsetConstraintIdx: cObj.userData.constraintIdx,
              offsetGroup: c.offsetGroup,
              defaultDistance: c.distance,
            });
            useStore.getState().setSketchConstraintMode("distance");
          } else if (c && c.type === "rectangularPattern") {
            // Re-open the Rectangular Pattern tool seeded from this pattern
            // so its counts/offsets can be edited and re-confirmed.
            useStore
              .getState()
              .beginRectangularPatternEdit(
                selectedIdRef.current,
                cObj.userData.constraintIdx,
              );
          } else if (c && c.type === "mirror") {
            useStore
              .getState()
              .beginMirrorEdit(
                selectedIdRef.current,
                cObj.userData.constraintIdx,
              );
          } else if (c && c.type === "centre") {
            // Re-open the Centre dialog on this constraint to edit it.
            useStore
              .getState()
              .beginCentreEdit(
                selectedIdRef.current,
                cObj.userData.constraintIdx,
              );
          } else if (c && c.type === "circularPattern") {
            useStore
              .getState()
              .beginCircularPatternEdit(
                selectedIdRef.current,
                cObj.userData.constraintIdx,
              );
          } else if (c && c.type === "text") {
            // Re-open the Text dialog seeded from this text shape so its
            // contents / height / font can be edited and re-committed.
            const ts = (dblSel.shapes || [])[c.shapeIdx];
            if (ts && ts.type === "text")
              useStore.getState().setTextDraft({
                x: ts.x,
                y: ts.y,
                text: ts.text,
                heightMm: ts.height * MM_PER_UNIT,
                font: ts.font,
                editIdx: c.shapeIdx,
              });
          }
          return;
        }
      }

      // Otherwise select all lines reachable via coincident constraints
      clearMultiSelectOverlays();
      multiSelectedRef.current = [];
      const selItem = itemsRef.current.find(
        (i) => i.id === selectedIdRef.current,
      );
      const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
      const sketchGroup = sketchShapesGroupRef?.current;
      if (selItem && sketchMesh && sketchGroup) {
        const lineObjs = sketchGroup.children.filter(
          (c) =>
            c.userData.shapeIdx != null &&
            !c.userData.isOffset &&
            !c.userData.isMirror &&
            !c.userData.isCircularPattern &&
            !c.userData.isRectangularPattern &&
            !c.userData.isCornerBridge,
        );
        const hits = hitTestSketchLines(makeRay(sx, sy), lineObjs);
        if (hits.length > 0 && hits[0].object.userData.shapeIdx != null) {
          const hitIdx = hits[0].object.userData.shapeIdx;
          const hs = (selItem.shapes || [])[hitIdx];
          // Double-clicking a chamfer/bevel bridge edits its setback / radius.
          if (hs && (hs.kind === "chamfer" || hs.kind === "bevel")) {
            useStore.getState().setSketchDistanceInput({
              cornerResize: {
                sketchId: selItem.id,
                shapeIdx: hitIdx,
                mode: hs.kind,
              },
              defaultDistance:
                hs.distanceFormula ??
                (hs.kind === "bevel" ? hs.r : (hs.chamferData?.dist ?? 0)),
            });
            return;
          }
          const connected = collectConnectedShapes(
            hitIdx,
            selItem.shapes || [],
            selItem.constraints || [],
          );
          multiSelectedRef.current = connected;
          showMultiSelectOverlays(connected);
        }
      }
      return;
    }

    if (shift) {
      // Shift+click: toggle the hit element in/out of the multi-selection.
      // Selecting lines for a distance/length drops any measure point picks.
      if (useStore.getState().measureTool)
        useStore.getState().clearMeasurePicks();
      const sketchGroup = sketchShapesGroupRef?.current;
      if (!sketchGroup) return;
      const lineObjs = sketchGroup.children.filter(
        (c) =>
          c.userData.shapeIdx != null &&
          !c.userData.isOffset &&
          !c.userData.isMirror &&
          !c.userData.isCircularPattern &&
          !c.userData.isRectangularPattern &&
          !c.userData.isCornerBridge,
      );
      const hits = hitTestSketchLines(makeRay(sx, sy), lineObjs);
      let hitIdx =
        hits.length > 0 && hits[0].object.userData.shapeIdx != null
          ? hits[0].object.userData.shapeIdx
          : null;
      // Standalone POINT shapes aren't line objects, so the line hit-test
      // never sees them — snap for one so a point can join the pair
      // (midpoint's point + line/arc/curve selection).
      if (hitIdx == null) {
        const selItem = itemsRef.current.find(
          (i) => i.id === selectedIdRef.current,
        );
        const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
        if (selItem && sketchMesh) {
          const shapes = selItem.shapes || [];
          const snap = findSnap(sx, sy, shapes, sketchMesh);
          if (snap && shapes[snap.shapeIdx]?.type === "point")
            hitIdx = snap.shapeIdx;
        }
      }
      if (hitIdx != null) {
        // Seed from the current single-element selection so the natural
        // flow — click one element, shift-click a second — yields a 2-shape
        // multiselect.  Any element kind seeds: parallel/tangent want two
        // lines, but midpoint pairs a POINT with a line/arc/curve.
        if (multiSelectedRef.current.length === 0) {
          const sel = useStore.getState().selectedSketchElement;
          if (sel?.shapeIdx != null && sel.shapeIdx !== hitIdx)
            multiSelectedRef.current = [sel.shapeIdx];
        }
        multiSelectedRef.current = multiSelectedRef.current.includes(hitIdx)
          ? multiSelectedRef.current.filter((i) => i !== hitIdx)
          : [...multiSelectedRef.current, hitIdx];
        showMultiSelectOverlays(multiSelectedRef.current);
        if (multiSelectedRef.current.length > 0)
          useStore.getState().setSelectedSketchElement(null);
      }
      return;
    }

    // A chamfer/bevel value label click re-opens the resize input (same
    // flow as double-clicking the bridge itself).
    {
      const cg = sketchShapesGroupRef?.current;
      const cSel = itemsRef.current.find((i) => i.id === selectedIdRef.current);
      const cMesh = cSel ? objectsRef.current[cSel.id] : null;
      if (cg && cMesh) {
        const rect = renderer.domElement.getBoundingClientRect();
        for (const obj of cg.children) {
          if (!obj.userData.isCornerDim) continue;
          const lp = obj.userData.cornerDimLocalPos;
          const wp = new THREE.Vector3(lp.x, lp.y, 0.007)
            .applyQuaternion(cMesh.quaternion)
            .add(cMesh.position);
          const ndc = wp.clone().project(cameraRef.current);
          const px = ((ndc.x + 1) / 2) * rect.width + rect.left;
          const py = ((-ndc.y + 1) / 2) * rect.height + rect.top;
          if (Math.hypot(sx - px, sy - py) < 20) {
            const hs = (cSel.shapes || [])[obj.userData.shapeIdx];
            if (hs && (hs.kind === "chamfer" || hs.kind === "bevel")) {
              useStore.getState().setSketchDistanceInput({
                cornerResize: {
                  sketchId: cSel.id,
                  shapeIdx: obj.userData.shapeIdx,
                  mode: hs.kind,
                },
                defaultDistance:
                  hs.distanceFormula ??
                  (hs.kind === "bevel" ? hs.r : (hs.chamferData?.dist ?? 0)),
              });
              return;
            }
          }
        }
      }
    }

    // Check for constraint icon click before doing normal element select
    // (only when the Constraint selection type is enabled).
    if (effectiveSketchSelTypes(useStore.getState()).eff.constraint) {
      const cg = sketchShapesGroupRef?.current;
      const cSelItem = itemsRef.current.find(
        (i) => i.id === selectedIdRef.current,
      );
      const cMesh = cSelItem ? objectsRef.current[cSelItem.id] : null;
      if (cg && cMesh) {
        const cRect = renderer.domElement.getBoundingClientRect();
        const cObj = nearestConstraintMarker(
          cg.children,
          cMesh,
          cameraRef.current,
          cRect,
          sx,
          sy,
          14,
        );
        if (cObj) {
          clearMultiSelectOverlays();
          multiSelectedRef.current = [];
          selectConstraint(cObj.userData.constraintIdx);
          return;
        }
      }
    }
    clearConstraintSelection();

    // Normal click: clear multi-selection and do single-element select
    clearMultiSelectOverlays();
    multiSelectedRef.current = [];
    trySelectSketchElement(sx, sy);
  };

  return { doClick };
}
