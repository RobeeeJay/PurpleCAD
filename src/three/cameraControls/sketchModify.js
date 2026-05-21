// Chamfer / bevel modify mode: takes a sketch-corner click and either
// trims the two adjacent lines to insert a straight cut (chamfer) or
// fits a tangent arc between them (bevel).  showModifyPreview renders
// a live yellow ghost of the result; applyModify commits via
// store.applySketchModify.

import * as THREE from "three";
import { useStore } from "../../store";
import { moveShapePoint, getSketchShapePoints } from "../sceneObjects.js";
import { norm2, buildBevelArc } from "../sketchConstraints.js";

const MODIFY_DIST = 0.25;

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

  return { clearModifyPreview, applyModify, showModifyPreview };
}
