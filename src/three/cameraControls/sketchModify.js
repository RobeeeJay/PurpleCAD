// Chamfer / bevel modify mode: takes a sketch-corner click and either
// trims the two adjacent lines to insert a straight cut (chamfer) or
// fits a tangent arc between them (bevel).  showModifyPreview renders
// a live yellow ghost of the result; applyModify commits via
// store.applySketchModify.

import * as THREE from "three";
import { useStore } from "../../store";
import {
  moveShapePoint,
  getSketchShapePoints,
  MM_PER_UNIT,
} from "../sceneObjects.js";
import {
  buildBevelArc,
  computeChamfer,
  chamferConstraints,
} from "../sketchConstraints.js";
import { SKETCH_MODIFY_HIGHLIGHT } from "../theme.js";

// Setback (chamfer) / radius (bevel), in scene units, read live from the store
// so the toolbar input drives the same value the preview and commit use.
const modifyDist = () =>
  (useStore.getState().sketchModifyDistMm ?? 2.5) / MM_PER_UNIT;

export function createSketchModifyHelpers(
  { scene, renderer, objectsRef, itemsRef, selectedIdRef },
  { findSnap, propagateConstraints },
) {
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

  const computeModify = (shapes, junc, dist, mode) => {
    const { aIdx, aKey, bIdx, bKey } = junc;
    const sA = shapes[aIdx],
      sB = shapes[bIdx];
    let legDist = dist;
    if (mode === "bevel") {
      // For a bevel, `dist` is the desired fillet radius. The tangent points
      // sit r / tan(theta/2) back along each leg (theta = corner angle), so the
      // arc buildBevelArc fits through them actually has that radius. Without
      // this, the value was used as the leg setback and the radius came out
      // wrong at any non-right corner.
      const dirs = computeChamfer(sA, sB, aKey, bKey, 1);
      const dot = Math.max(
        -1,
        Math.min(1, dirs.uA.x * dirs.uB.x + dirs.uA.y * dirs.uB.y),
      );
      const halfTan = Math.tan(Math.acos(dot) / 2);
      legDist = halfTan > 1e-6 ? dist / halfTan : dist;
    }
    const geom = computeChamfer(sA, sB, aKey, bKey, legDist);
    return { ...geom, sA, sB, aIdx, aKey, bIdx, bKey, legDist };
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
    const m = computeModify(shapes, junc, modifyDist(), mode);
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
    // The shared corner's coincident is still present during propagation, so
    // propA/propB drag each other's corner endpoint to the wrong cut (and the
    // merge lets one win). Re-pin each trimmed line's corner endpoint to its
    // own cut; the junction constraint is removed below anyway.
    updates.set(
      m.aIdx,
      moveShapePoint(updates.get(m.aIdx) ?? newSA, m.aKey, m.trimA),
    );
    updates.set(
      m.bIdx,
      moveShapePoint(updates.get(m.bIdx) ?? newSB, m.bKey, m.trimB),
    );
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
          dist: m.legDist,
        };
      }
    }
    const newIdx = shapes.length;
    // A chamfer adds an angle lock at each of its two new corners (so it holds
    // its shape under edits); a bevel arc keeps just the coincident joins.
    const newConstraints =
      mode === "chamfer"
        ? chamferConstraints(newIdx, m.aIdx, m.aKey, m.bIdx, m.bKey, m)
        : [
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
    const m = computeModify(shapes, junc, modifyDist(), mode);
    const toW = (lx, ly) => {
      const v = new THREE.Vector3(lx, ly, 0.006);
      v.applyQuaternion(sketchMesh.quaternion);
      v.add(sketchMesh.position);
      return v;
    };
    const previewMat = new THREE.LineBasicMaterial({
      color: SKETCH_MODIFY_HIGHLIGHT,
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

  return { clearModifyPreview, applyModify, showModifyPreview };
}
