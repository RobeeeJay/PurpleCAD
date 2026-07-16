// Click handlers for the sketch constraint tools.
//   • handleDistanceConstraintClick   — distance / radius / length
//   • handleCoincidentClick           — coincident + on-line constraints
// Both run off the sketch-mode click handler and read snap info from
// `findSnap`; on success they kick the React layer via store actions
// (setSketchDistanceInput, addSketchConstraints, …).

import * as THREE from "three";
import { useStore } from "../../store";
import { projectOntoLine } from "../sketchConstraints.js";
import {
  getShapePoint,
  getSnapPoints,
  moveShapePoint,
} from "../sceneObjects.js";
import { CONSTRAINT_PARALLEL_PERP_COLOR } from "../theme.js";

export function createSketchConstraintHandlers(
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
) {
  const handleDistanceConstraintClick = (screenX, screenY) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    const shapes = selItem.shapes || [];
    const store = useStore.getState();
    // Offset-result geometry is positioned by its offset constraint; a dimension
    // on it would over-constrain and fight that.  Reject any pick on an offset
    // copy (the original it was offset from stays dimensionable).
    const constraints = selItem.constraints || [];
    const isOffsetCopy = (idx) =>
      constraints.some((c) => c.type === "offset" && c.shapeIdx === idx);
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
      if (!shape || isOffsetCopy(lineIdx)) return;
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

    if (isOffsetCopy(snap.shapeIdx)) return;
    const firstPt = store.sketchConstraintFirstPoint;
    if (!firstPt) {
      store.setSketchConstraintFirstPoint({
        shapeIdx: snap.shapeIdx,
        pointKey: snap.pointKey,
      });
      clearCoincidentFirstOverlay();
      const overlay = makeRingOverlay(
        { x: snap.x, y: snap.y },
        sketchMesh,
        CONSTRAINT_PARALLEL_PERP_COLOR,
      );
      setCoincidentFirstOverlay(overlay);
      scene.add(overlay);
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
      const overlay = makeRingOverlay(
        { x: snap.x, y: snap.y },
        sketchMesh,
        CONSTRAINT_PARALLEL_PERP_COLOR,
      );
      setCoincidentFirstOverlay(overlay);
      scene.add(overlay);
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

  // Guided midpoint flow: collect a point (a standalone point shape, or any
  // snappable point of another shape — endpoint / centre) and a
  // line/arc/bezier target in either order (each pick ringed), then apply
  // and leave the mode — mirrors the coincident tool's UX.
  const MIDPOINT_TARGETS = ["line", "arc", "bezier"];
  const handleMidpointClick = (screenX, screenY) => {
    const selItem = itemsRef.current.find(
      (i) => i.id === selectedIdRef.current,
    );
    const sketchMesh = selItem ? objectsRef.current[selItem.id] : null;
    if (!selItem || !sketchMesh) return;
    const shapes = selItem.shapes || [];
    const store = useStore.getState();
    const first = store.sketchMidpointFirst;

    const finish = (pointIdx, pointKey, targetIdx) => {
      clearCoincidentFirstOverlay();
      store.setSketchMidpointFirst(null);
      store.setSketchConstraintMode(null);
      store.applySketchPairConstraint(
        selectedIdRef.current,
        pointIdx,
        targetIdx,
        "midpoint",
        { pointIdx, pointKey },
      );
    };
    const ringAt = (x, y) => {
      clearCoincidentFirstOverlay();
      const overlay = makeRingOverlay(
        { x, y },
        sketchMesh,
        CONSTRAINT_PARALLEL_PERP_COLOR,
      );
      setCoincidentFirstOverlay(overlay);
      scene.add(overlay);
    };

    // A snapped point wins over a line-body hit: a standalone point shape or
    // any keyed point (line/arc endpoint, circle/arc centre, bezier end).
    const snap = findSnap(screenX, screenY, shapes, sketchMesh);
    if (snap) {
      const pointShape = shapes[snap.shapeIdx];
      const key = pointShape?.type === "point" ? null : (snap.pointKey ?? null);
      if (pointShape?.type === "point" || key) {
        if (first?.kind === "target") {
          finish(snap.shapeIdx, key, first.shapeIdx);
        } else {
          store.setSketchMidpointFirst({
            kind: "point",
            shapeIdx: snap.shapeIdx,
            pointKey: key,
          });
          ringAt(snap.x, snap.y);
        }
        return;
      }
    }

    const sketchGroup = sketchShapesGroupRef?.current;
    if (!sketchGroup) return;
    const hits = hitTestSketchLines(
      makeRay(screenX, screenY),
      sketchGroup.children.filter((c) => c.userData.shapeIdx != null),
    );
    const idx = hits[0]?.object?.userData?.shapeIdx;
    if (idx == null) return;
    const shape = shapes[idx];
    if (!MIDPOINT_TARGETS.includes(shape?.type)) return;
    if (first?.kind === "point") {
      finish(first.shapeIdx, first.pointKey ?? null, idx);
    } else {
      const m =
        shape.type === "line"
          ? { x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2 }
          : null;
      store.setSketchMidpointFirst({ kind: "target", shapeIdx: idx });
      if (m) ringAt(m.x, m.y);
    }
  };

  return {
    handleDistanceConstraintClick,
    handleCoincidentClick,
    handleMidpointClick,
  };
}
