// "Active sketch tool" interaction: live preview while the cursor
// moves, and the click commits.  Handles the line / rect / circle /
// ellipse / arc / bezier tools, manages the multi-click chain for
// poly-lines, and writes finished shapes to the store via
// addSketchShape(s).

import * as THREE from "three";
import { useStore } from "../../store";
import {
  buildSketchShape,
  getSketchShapePoints,
  sketchDimText,
  snapUnitToIntervalMm,
  defaultBezierControls,
} from "../sceneObjects.js";
import { SKETCH_DRAW_PREVIEW_COLOR } from "../theme.js";

// Snap a local sketch point to the world-space grid interval when the snap
// option is on.  Geometry snapping (findSnap) takes precedence and is applied
// before this.
const gridSnapLocal = (pt) => {
  const s = useStore.getState();
  if (!pt || !s.snapEnabled || !(s.snapDistanceMm > 0)) return pt;
  return {
    x: snapUnitToIntervalMm(pt.x, s.snapDistanceMm),
    y: snapUnitToIntervalMm(pt.y, s.snapDistanceMm),
  };
};

// When a freshly-drawn line lands within ~1.1° of an axis, snap it exactly onto
// that axis and report the matching horizontal/vertical constraint, so drawing
// a level line auto-constrains it.  Only the endpoint that isn't pinned to
// existing geometry is moved (moving a snapped endpoint would break its
// coincident join); if both ends are pinned, the slope isn't ours to change so
// we leave it alone.  Returns { shape, constraint } or null.
const AXIS_TOL = 0.02; // sin of the angle tolerance, ~1.1°
export function axisAlignLine(shape, shapeIdx, startSnapped, endSnapped) {
  if (!shape || shape.type !== "line") return null;
  if (startSnapped && endSnapped) return null;
  const dx = shape.x2 - shape.x1;
  const dy = shape.y2 - shape.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const tol = AXIS_TOL * len;
  if (Math.abs(dy) <= tol) {
    const shape2 = endSnapped
      ? { ...shape, y1: shape.y2 }
      : { ...shape, y2: shape.y1 };
    return { shape: shape2, constraint: { type: "horizontal", shapeIdx } };
  }
  if (Math.abs(dx) <= tol) {
    const shape2 = endSnapped
      ? { ...shape, x1: shape.x2 }
      : { ...shape, x2: shape.x1 };
    return { shape: shape2, constraint: { type: "vertical", shapeIdx } };
  }
  return null;
}

export function createSketchDrawHelpers(
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
) {
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
      } else {
        effectiveCur = gridSnapLocal(cur);
      }
    }
    draw.currentSnap = activeSnap;

    clearSketchPreview();
    clearHoverFills();

    if (draw.tool === "bezier") {
      // Endpoint-only preview: p0 is placed, the cursor is p3, and the control
      // points come from the default-bow so the user sees the curve they'll get.
      const p0 = draw.points[0];
      const p3 = effectiveCur;
      const toWorld = (p) => {
        const v = new THREE.Vector3(p.x, p.y, 0.003);
        v.applyQuaternion(sketchMesh.quaternion);
        v.add(sketchMesh.position);
        return v;
      };
      const { p1, p2 } = defaultBezierControls(p0, p3);
      const curve = new THREE.CubicBezierCurve(
        new THREE.Vector2(p0.x, p0.y),
        new THREE.Vector2(p1.x, p1.y),
        new THREE.Vector2(p2.x, p2.y),
        new THREE.Vector2(p3.x, p3.y),
      );
      const curvePts = curve.getPoints(48).map(({ x, y }) => toWorld({ x, y }));
      const curveLine = makePreviewLine2(curvePts);
      if (curveLine) {
        scene.add(curveLine);
        draw.previewObjects.push(curveLine);
      }
      // Dotted handle hints (p0→p1, p3→p2) so the tangents read while drawing.
      for (const [a, b] of [
        [p0, p1],
        [p3, p2],
      ]) {
        const hl = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([toWorld(a), toWorld(b)]),
          new THREE.LineDashedMaterial({
            color: SKETCH_DRAW_PREVIEW_COLOR,
            dashSize: 0.08,
            gapSize: 0.05,
            transparent: true,
            opacity: 0.6,
            depthTest: false,
          }),
        );
        hl.computeLineDistances();
        hl.renderOrder = 1001;
        scene.add(hl);
        draw.previewObjects.push(hl);
      }
      if (dimHintRef.current) {
        const rect = renderer.domElement.getBoundingClientRect();
        dimHintRef.current.textContent = sketchDimText("line", p0, p3);
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
      else localPt = gridSnapLocal(localPt);
    }

    // Helper: build constraints from recorded snaps for a completed shape.
    // Also creates coincident constraints for any existing points that are
    // already coincident with the snapped point, so the new shape is fully
    // connected at multi-point junctions.
    const buildConstraints = (snaps, tool, keysOverride) => {
      const newIdx = shapes.length;
      const existingConstraints = selItem?.constraints || [];
      return snaps.flatMap((snap, i) => {
        if (!snap) return [];
        const pointKeys =
          keysOverride ??
          (tool === "bezier" ? ["p0", "p1", "p2", "p3"] : ["start", "end"]);
        const newPointKey = pointKeys[i] ?? `p${i}`;
        const primary = {
          type: "coincident",
          shapeAIdx: newIdx,
          pointA: newPointKey,
          shapeBIdx: snap.shapeIdx,
          pointB: snap.pointKey,
        };
        const extras = existingConstraints
          .filter((c) => c.type === "coincident")
          .flatMap((c) => {
            if (c.shapeAIdx === snap.shapeIdx && c.pointA === snap.pointKey) {
              return [
                {
                  type: "coincident",
                  shapeAIdx: newIdx,
                  pointA: newPointKey,
                  shapeBIdx: c.shapeBIdx,
                  pointB: c.pointB,
                },
              ];
            }
            if (c.shapeBIdx === snap.shapeIdx && c.pointB === snap.pointKey) {
              return [
                {
                  type: "coincident",
                  shapeAIdx: newIdx,
                  pointA: newPointKey,
                  shapeBIdx: c.shapeAIdx,
                  pointB: c.pointA,
                },
              ];
            }
            return [];
          });
        return [primary, ...extras];
      });
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
      // Endpoint-only flow: the first click placed p0; this second click places
      // p3.  The control points start at a sensible default (a gentle bow) and
      // are reshaped later by dragging the curve's handles when it's selected.
      const draw = sketchDrawRef.current;
      const p0 = draw.points[0];
      const p3 = localPt;
      draw.snaps.push(clickSnap);
      // snaps = [start(p0), end(p3)] — map them to the bezier's endpoint keys.
      const constraints = buildConstraints(draw.snaps, "bezier", ["p0", "p3"]);
      const { p1, p2 } = defaultBezierControls(p0, p3);
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
      {
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
          const contSnap = draw.snaps[1] ?? {
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
            // A rectangle is drawn axis-aligned, so lock each side to its axis
            // (top/bottom horizontal, left/right vertical) — matching the
            // auto-H/V applied to free-drawn lines.  This holds the right
            // angles and keeps the rectangle axis-aligned under edits.
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
        let finalShape = shape;
        let endPt = localPt;
        if (shape) {
          const hv = axisAlignLine(
            shape,
            shapes.length,
            !!draw.snaps[0],
            !!clickSnap,
          );
          if (hv) {
            finalShape = hv.shape;
            constraints.push(hv.constraint);
            endPt = { x: hv.shape.x2, y: hv.shape.y2 };
          }
          useStore
            .getState()
            .addSketchShape(selectedIdRef.current, finalShape, constraints);
        }
        // End the chain whenever the user clicks on ANY existing snap point
        // (not just the chain's start) — connecting back to another shape's
        // endpoint or midpoint is a natural "I'm done drawing" gesture.
        if (clickSnap) {
          sketchDrawRef.current = null;
          setSketchDrawPhase("first");
          useStore.getState().setActiveSketchTool(null);
        } else {
          // Carry the original chain start forward so closes-back-to-start
          // detection still works on subsequent clicks.  Previously this
          // line referenced an undeclared `chainStart`, which threw inside
          // the object literal — the assignment never landed, sketchDrawRef
          // kept its old `startLocal = P1`, and the *next* click committed
          // a line P1→P3 (the user-visible bug: "second line starts at the
          // first line's start, not its end").
          const chainStart = draw.chainStartPoint;
          const contSnap = clickSnap ?? {
            shapeIdx: shapes.length,
            pointKey: "end",
            x: endPt.x,
            y: endPt.y,
          };
          sketchDrawRef.current = {
            tool: "line",
            startLocal: endPt,
            points: [endPt],
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

  return { updateSketchPreview, handleSketchClick };
}
