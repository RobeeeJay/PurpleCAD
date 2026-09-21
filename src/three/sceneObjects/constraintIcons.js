// Constraint icon overlays: builds what the sketch shows for each constraint --
// the toolbar's own icon beside a constrained point or line (coincident,
// horizontal, vertical, distance, midpoint, parallel, ... see
// constraintIconSprites.js), distance dimension lines + labels, on-line ticks,
// angle arcs + degree labels -- plus the drag-time rebuild.  Split out of sketchOverlays.js to keep that file focused
// on the shape/region geometry.

import * as THREE from "three";
import { addCentreConstraintIcon } from "./centreConstraintIcon.js";
import {
  addCogConstraintIcon,
  addTextConstraintIcon,
} from "./primitiveConstraintIcons.js";
import {
  besideLabel,
  ICON_ABOVE,
  ICON_BELOW,
  ICON_LEFT,
  ICON_RIGHT,
  ICON_UP_RIGHT,
  makeConstraintIconSprite,
} from "./constraintIconSprites.js";

// For each line whose own length dimension is drawn, which side of the line
// the dimension sits on (sketch-local unit perpendicular).  A line-length
// dimension is offset along the perpendicular of its measured direction, the
// same rule the distance branch below draws it by.
export function lengthDimensionSides(constraints, shapes) {
  const sides = new Map();
  for (const c of constraints) {
    if (c.type !== "distance" || c.shapeAIdx !== c.shapeBIdx) continue;
    const line = shapes[c.shapeAIdx];
    if (line?.type !== "line") continue;
    const a = getShapePoint(line, c.pointA);
    const b = getShapePoint(line, c.pointB);
    if (!a || !b) continue;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    sides.set(c.shapeAIdx, { x: -(b.y - a.y) / len, y: (b.x - a.x) / len });
  }
  return sides;
}
import { shapeMidpoint, cornerSetback } from "../sketchGeometry.js";
import { MM_PER_UNIT } from "./dimensions.js";
import { resolveConstraintDistance } from "../geometryParams.js";
import { getShapePoint } from "./sketchShapes.js";
import { useStore } from "../../store";
import { isFormulaValue, variablesToMap } from "../../utils/formulas.js";
import { conflictingDimensions } from "../sketchDimensionConflicts.js";
import {
  ANGLE_LABEL_TEXT,
  CONSTRAINT_ANGLE_COLOR,
  CONSTRAINT_COINCIDENT_COLOR,
  CONSTRAINT_HORIZONTAL_COLOR,
  CONSTRAINT_ON_LINE_COLOR,
  dimConflictColorFor,
  dimValueColorFor,
  sketchMirrorColorFor,
  sketchCircularPatternColorFor,
  sketchRectangularPatternColorFor,
  toCssHex,
} from "../theme.js";

// Re-exported so the sketch-overlay modules keep importing it from here; it
// lives in utils/formulas.js because the store needs it too and must not pull
// in a THREE module.
export { isFormulaValue };

// A dimension value label sprite: transparent background, value-only text.  A
// formula/variable-derived value shows only the resolved value, prefixed with
// the function symbol (ƒ) rather than spelling out the expression.  Returns the
// sprite; the caller sets its position and any userData.
export function makeDimLabelSprite(
  text,
  { theme, isFormula = false, baseW = 0.7, color = null },
) {
  const labelText = (isFormula ? "ƒ " : "") + text;
  const labelFont = "bold 18px sans-serif";
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  ctx.font = labelFont;
  canvas.width = Math.max(
    160,
    Math.ceil(ctx.measureText(labelText).width) + 24,
  );
  canvas.height = 32;
  // No background fill — the label reads directly over the sketch.
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color ?? toCssHex(dimValueColorFor(theme));
  ctx.font = labelFont;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(labelText, canvas.width / 2, canvas.height / 2);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas),
      depthTest: false,
      transparent: true,
    }),
  );
  sprite.scale.set(baseW * (canvas.width / 160), 0.175, 1);
  sprite.renderOrder = 1009;
  // The canvas is padded well past the text; a marker placed beside the label
  // goes beside the TEXT.
  sprite.userData.textWidthFraction =
    ctx.measureText(labelText).width / canvas.width;
  sprite.userData.labelText = labelText;
  return sprite;
}

// Builds constraint icon THREE.js objects into `group`. All objects are tagged
// with userData.isConstraintObj so they can be found and replaced during drag.
export function addConstraintIconsToGroup(
  group,
  constraints,
  shapes,
  toWorld,
  res,
  showDimensions = true,
  editHidden = null,
  showConstraints = true,
) {
  const R = 0.14;
  // The sketch plane's normal in world space (toWorld maps sketch-local → world,
  // so local +Z is the normal).  Dimension offsets take the perpendicular IN the
  // plane via cross(normal, dir) — a world-XY perpendicular only works when the
  // sketch sits on the world XY plane and otherwise pushes the dimension out of
  // the plane (or to NaN for a line along world Z).
  const sketchNormal = toWorld(0, 0, 1)
    .sub(toWorld(0, 0, 0))
    .normalize();
  const theme = useStore.getState().theme;
  // Dimensions a variable change could not apply are drawn in red.  The flag
  // says which ones were refused; the residual is re-checked here against the
  // LIVE shapes, so a dimension that has since been satisfied (by a drag, or a
  // later variable edit) stops being red with nothing having to clear it.
  const flagged = useStore.getState().dimensionConflicts;
  const conflicting = flagged?.size
    ? new Set(
        conflictingDimensions(
          shapes,
          constraints.filter((c) => flagged.has(c)),
          variablesToMap(useStore.getState().variables),
        ),
      )
    : null;
  // Where each line's own dimension sits, so a horizontal / vertical marker can
  // keep off it.  Only when dimensions are drawn at all.
  const dimensionSides = showDimensions
    ? lengthDimensionSides(constraints, shapes)
    : new Map();
  // Offset constraints created together share an offsetGroup; render only one
  // editable dimension label per group (they all carry the same distance).
  const seenOffsetGroups = new Set();
  constraints.forEach((c, ci) => {
    // Skip the icon of a mirror / pattern copy that's hidden while its
    // operation is being edited (the copy shape itself is hidden too).
    if (
      editHidden &&
      typeof c.shapeIdx === "number" &&
      editHidden.has(c.shapeIdx)
    )
      return;
    // The two visibility toggles are independent: "dimensions" owns the
    // measured annotations (labels + their marker lines), "constraints" owns
    // every other constraint icon.  An angle is both — its arc is an icon,
    // its degree label a dimension (gated below).
    const isDimensionType =
      c.type === "distance" ||
      c.type === "pointLineDistance" ||
      c.type === "offset";
    if (isDimensionType && !showDimensions && c.type !== "distance") return;
    // Every annotation of a conflicting dimension turns red together -- label,
    // dimension line and its ticks -- so the whole measurement reads as wrong
    // rather than just its number.
    const dimColor = conflicting?.has(c)
      ? dimConflictColorFor(theme)
      : dimValueColorFor(theme);
    if (!isDimensionType && !showConstraints) return;
    const tag = (obj, iconLocalPos, shapeIndices, color) => {
      obj.userData.isConstraintObj = true;
      obj.userData.isConstraint = true;
      obj.userData.constraintIdx = ci;
      obj.userData.constraintType = c.type;
      obj.userData.constraintIconLocalPos = iconLocalPos;
      obj.userData.constraintShapeIndices = shapeIndices;
      obj.userData.constraintColor = color;
      // Annotations are overlays: never frustum-cull them, or an offset
      // dimension whose line/arrows sit outside a tight settled view gets the
      // whole object dropped and the dimension vanishes.
      obj.frustumCulled = false;
    };
    // The toolbar icon for this constraint, `dir` of the anchor `at`
    // (sketch-local), a fixed number of screen pixels away.  `color` is what
    // hovering the icon paints the constrained geometry.
    const placeIcon = (at, dir, shapeIndices, color, type = c.type) => {
      const sprite = makeConstraintIconSprite(type, dir, theme);
      sprite.position.copy(toWorld(at.x, at.y, 0.007));
      tag(sprite, { x: at.x, y: at.y }, shapeIndices, color);
      group.add(sprite);
    };
    const addTagged = (obj) => {
      obj.userData.isConstraintObj = true;
      obj.userData.constraintIdx = ci;
      obj.userData.constraintType = c.type;
      obj.frustumCulled = false;
      group.add(obj);
    };
    // Recenter a small glyph's geometry on a world anchor and park the object
    // there, so the animate loop can scale it about that point to a constant
    // on-screen size (the geometry is otherwise baked in absolute world coords).
    // Only for fixed-size marks — NOT the dimension/leader lines, which must
    // keep spanning the measured geometry.
    const markFixedSize = (obj, anchor) => {
      if (obj.geometry) obj.geometry.translate(-anchor.x, -anchor.y, -anchor.z);
      obj.position.copy(anchor);
      obj.frustumCulled = false;
      obj.userData.constraintMark = true;
    };

    // ── Shared technical-drawing dimension primitives (grey, with tick-mark
    // ends instead of arrowheads) used by both distance and offset dimensions.
    // A world-space dimension / extension / witness line (scales with zoom so it
    // keeps spanning the measured geometry — not a fixed-size mark).
    const addDimSeg = (p0, p1) => {
      const l = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([p0, p1]),
        new THREE.LineBasicMaterial({
          color: dimColor,
          depthTest: false,
        }),
      );
      l.renderOrder = 1004;
      addTagged(l);
      return l;
    };
    // A short crossbar PERPENDICULAR to the dimension line, centred on its end
    // and kept a constant on-screen size — the technical-drawing terminator that
    // replaces an arrowhead.  `perp` is the dimension line's in-plane normal.
    const addDimTick = (tip, perp) => {
      const TICK = 0.1;
      const t = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          tip.clone().addScaledVector(perp, TICK),
          tip.clone().addScaledVector(perp, -TICK),
        ]),
        new THREE.LineBasicMaterial({
          color: dimColor,
          depthTest: false,
        }),
      );
      t.renderOrder = 1005;
      addTagged(t);
      markFixedSize(t, tip);
    };

    if (c.type === "coincident") {
      const shapeA = shapes[c.shapeAIdx];
      if (!shapeA) return;
      const pt = getShapePoint(shapeA, c.pointA);
      if (!pt) return;
      placeIcon(
        pt,
        ICON_UP_RIGHT,
        [c.shapeAIdx, c.shapeBIdx],
        CONSTRAINT_COINCIDENT_COLOR,
      );
    } else if (c.type === "distance") {
      const sA = shapes[c.shapeAIdx],
        sB = shapes[c.shapeBIdx];
      if (!sA || !sB) return;
      const isRadius =
        c.shapeAIdx === c.shapeBIdx &&
        c.pointB === "edge" &&
        sA.type === "circle";
      let posA = getShapePoint(sA, c.pointA),
        posB = getShapePoint(sB, c.pointB);
      if (!posA || !posB) return;
      const distShapeIdxs =
        c.shapeAIdx === c.shapeBIdx
          ? [c.shapeAIdx]
          : [c.shapeAIdx, c.shapeBIdx];
      // With its dimension drawn, the marker goes beside the value label
      // (placed after the label, below).  Without one, beside what it measures.
      if (!showDimensions) {
        if (showConstraints)
          placeIcon(
            { x: (posA.x + posB.x) / 2, y: (posA.y + posB.y) / 2 },
            ICON_UP_RIGHT,
            distShapeIdxs,
            dimColor,
          );
        return;
      }
      // A line-length dimension measures the SHARP corner, so its witness lines
      // must reach the virtual (pre-chamfer/fillet) corner, not the trimmed
      // edge — extend each end outward along the edge by its corner setback.
      if (
        !isRadius &&
        c.shapeAIdx === c.shapeBIdx &&
        sA.type === "line" &&
        ["start", "end"].includes(c.pointA) &&
        ["start", "end"].includes(c.pointB)
      ) {
        const setA = cornerSetback(shapes, c.shapeAIdx, c.pointA);
        const setB = cornerSetback(shapes, c.shapeBIdx, c.pointB);
        const len = Math.hypot(posB.x - posA.x, posB.y - posA.y) || 1;
        const ux = (posB.x - posA.x) / len,
          uy = (posB.y - posA.y) / len;
        if (setA) posA = { x: posA.x - ux * setA, y: posA.y - uy * setA };
        if (setB) posB = { x: posB.x + ux * setB, y: posB.y + uy * setB };
      }
      const wA = toWorld(posA.x, posA.y, 0.006),
        wB = toWorld(posB.x, posB.y, 0.006);
      const dir = new THREE.Vector3().subVectors(wB, wA).normalize();
      // In-plane perpendicular (works on any sketch plane, not just world XY).
      const perpU = sketchNormal.clone().cross(dir).normalize();
      const distShapes =
        c.shapeAIdx === c.shapeBIdx
          ? [c.shapeAIdx]
          : [c.shapeAIdx, c.shapeBIdx];
      let labelPos;
      let labelLocal;
      // Which side of its label the marker goes: AWAY from the measured
      // geometry.  A label pushed sideways off a vertical line would otherwise
      // put the marker back over the line, on top of that line's own markers.
      let markerSide = 1;
      if (isRadius) {
        // Stored as a radius, drawn as a diameter: a line across the whole
        // circle through its centre, ticked where it meets the arc on both
        // sides, running on past the arc to the label.
        const wLineTo = wB.clone().addScaledVector(dir, 0.35);
        const wFar = wA.clone().sub(wB).add(wA);
        const leader = addDimSeg(wFar, wLineTo);
        tag(
          leader,
          { x: (posA.x + posB.x) / 2, y: (posA.y + posB.y) / 2 },
          distShapes,
          dimColor,
        );
        addDimTick(wB, perpU);
        addDimTick(wFar, perpU);
        labelPos = wLineTo.clone().addScaledVector(dir, 0.45);
        const rlen = Math.hypot(posB.x - posA.x, posB.y - posA.y) || 1;
        labelLocal = {
          x: posB.x + ((posB.x - posA.x) / rlen) * 0.8,
          y: posB.y + ((posB.y - posA.y) / rlen) * 0.8,
        };
        if (posB.x < posA.x) markerSide = -1;
      } else {
        // Linear: a dimension line offset from the geometry, bounded by two
        // extension (witness) lines, with a tick mark at each end — the value
        // breaks the line at the middle.
        const OFF = 0.55,
          GAP = 0.06,
          OVER = 0.14;
        const A2 = wA.clone().addScaledVector(perpU, OFF);
        const B2 = wB.clone().addScaledVector(perpU, OFF);
        addDimSeg(
          wA.clone().addScaledVector(perpU, GAP),
          A2.clone().addScaledVector(perpU, OVER),
        );
        addDimSeg(
          wB.clone().addScaledVector(perpU, GAP),
          B2.clone().addScaledVector(perpU, OVER),
        );
        const dimLine = addDimSeg(A2, B2);
        // Hotspot for double-click sits on the dimension line, in sketch-local.
        const llen = Math.hypot(posB.x - posA.x, posB.y - posA.y) || 1;
        const lpx = -(posB.y - posA.y) / llen,
          lpy = (posB.x - posA.x) / llen;
        tag(
          dimLine,
          {
            x: (posA.x + posB.x) / 2 + lpx * OFF,
            y: (posA.y + posB.y) / 2 + lpy * OFF,
          },
          distShapes,
          dimColor,
        );
        addDimTick(A2, perpU);
        addDimTick(B2, perpU);
        labelPos = new THREE.Vector3().addVectors(A2, B2).multiplyScalar(0.5);
        labelLocal = {
          x: (posA.x + posB.x) / 2 + lpx * OFF,
          y: (posA.y + posB.y) / 2 + lpy * OFF,
        };
        // Pushed mostly sideways (a steep line): continue in that direction.
        if (Math.abs(lpx) > Math.SQRT1_2 && lpx < 0) markerSide = -1;
      }
      // c.distance may be a number or a formula string; evaluate before display.
      const resolvedDist = resolveConstraintDistance(c);
      // When the constraint's value is a formula (any string that isn't a
      // bare number), surface it on the label so the user can see which
      // variable / expression drives the dimension.  A bare-number string
      // ("10.5") is shown as just the mm value, matching the legacy look.
      const valueMm = (resolvedDist * MM_PER_UNIT * (isRadius ? 2 : 1)).toFixed(
        1,
      );
      const sprite = makeDimLabelSprite(`${isRadius ? "Ø " : ""}${valueMm}mm`, {
        theme,
        isFormula: isFormulaValue(c.distance),
        color: toCssHex(dimColor),
      });
      sprite.position.copy(labelPos);
      addTagged(sprite);
      if (showConstraints) {
        placeIcon(labelLocal, ICON_RIGHT, distShapeIdxs, dimColor);
        besideLabel(group.children.at(-1), sprite, markerSide);
      }
    } else if (c.type === "pointLineDistance") {
      const lineShape = shapes[c.lineShapeIdx];
      const ptShape = shapes[c.pointShapeIdx];
      if (!lineShape || lineShape.type !== "line" || !ptShape) return;
      const pt = getShapePoint(ptShape, c.pointKey ?? "point");
      if (!pt) return;
      const ldx = lineShape.x2 - lineShape.x1,
        ldy = lineShape.y2 - lineShape.y1;
      const llen2 = Math.hypot(ldx, ldy);
      if (llen2 < 1e-10) return;
      // Foot of the perpendicular on the INFINITE line — the dimension line
      // runs point → foot, with a tick at each end.
      const t =
        ((pt.x - lineShape.x1) * ldx + (pt.y - lineShape.y1) * ldy) /
        (llen2 * llen2);
      const foot = {
        x: lineShape.x1 + ldx * t,
        y: lineShape.y1 + ldy * t,
      };
      const wP = toWorld(pt.x, pt.y, 0.006);
      const wF = toWorld(foot.x, foot.y, 0.006);
      let labelPos = new THREE.Vector3().addVectors(wP, wF).multiplyScalar(0.5);
      if (wP.distanceTo(wF) > 1e-6) {
        // Same technical-drawing treatment as a two-point dimension: the
        // dimension line sits OFFSET to the side (along the measured line's
        // direction), bounded by witness lines from the point and the foot,
        // with a tick at each end.
        const dimU = new THREE.Vector3().subVectors(wF, wP).normalize();
        const perpU = sketchNormal.clone().cross(dimU).normalize();
        const OFF = 0.55,
          GAP = 0.06,
          OVER = 0.14;
        const A2 = wP.clone().addScaledVector(perpU, OFF);
        const B2 = wF.clone().addScaledVector(perpU, OFF);
        addDimSeg(
          wP.clone().addScaledVector(perpU, GAP),
          A2.clone().addScaledVector(perpU, OVER),
        );
        addDimSeg(
          wF.clone().addScaledVector(perpU, GAP),
          B2.clone().addScaledVector(perpU, OVER),
        );
        const dimLine = addDimSeg(A2, B2);
        // Hotspot on the dimension line, in sketch-local (perp of point→foot).
        const fdx = foot.x - pt.x,
          fdy = foot.y - pt.y;
        const flen = Math.hypot(fdx, fdy) || 1;
        const lpx = -fdy / flen,
          lpy = fdx / flen;
        tag(
          dimLine,
          {
            x: (pt.x + foot.x) / 2 + lpx * OFF,
            y: (pt.y + foot.y) / 2 + lpy * OFF,
          },
          [c.pointShapeIdx, c.lineShapeIdx],
          dimColor,
        );
        addDimTick(A2, perpU);
        addDimTick(B2, perpU);
        labelPos = new THREE.Vector3().addVectors(A2, B2).multiplyScalar(0.5);
      }
      const valueMm = (resolveConstraintDistance(c) * MM_PER_UNIT).toFixed(1);
      const sprite = makeDimLabelSprite(`${valueMm}mm`, {
        theme,
        isFormula: isFormulaValue(c.distance),
        color: toCssHex(dimColor),
      });
      sprite.position.copy(labelPos);
      addTagged(sprite);
    } else if (c.type === "onLine") {
      const lineShape = shapes[c.lineShapeIdx];
      const ptShape = shapes[c.pointShapeIdx];
      if (!lineShape || lineShape.type !== "line" || !ptShape) return;
      const pt = getShapePoint(ptShape, c.pointKey);
      if (!pt) return;
      const dx = lineShape.x2 - lineShape.x1,
        dy = lineShape.y2 - lineShape.y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-10) return;
      const nx = (-dy / len) * R,
        ny = (dx / len) * R;
      const tLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          toWorld(pt.x + nx, pt.y + ny, 0.005),
          toWorld(pt.x - nx, pt.y - ny, 0.005),
        ]),
        new THREE.LineBasicMaterial({
          color: CONSTRAINT_ON_LINE_COLOR,
          depthTest: false,
        }),
      );
      tLine.renderOrder = 1004;
      tag(
        tLine,
        { x: pt.x, y: pt.y },
        [c.pointShapeIdx, c.lineShapeIdx],
        CONSTRAINT_ON_LINE_COLOR,
      );
      group.add(tLine);
      markFixedSize(tLine, toWorld(pt.x, pt.y, 0.005));
    } else if (c.type === "horizontal" || c.type === "vertical") {
      const shape = shapes[c.shapeIdx];
      if (!shape || shape.type !== "line") return;
      // Horizontal sits above the line's middle, vertical to its right --
      // unless the line's own dimension is drawn on that side, where the
      // marker would sit on the value; then it takes the other side.
      const dim = dimensionSides.get(c.shapeIdx);
      const dir =
        c.type === "horizontal"
          ? dim && dim.y > 0.5
            ? ICON_BELOW
            : ICON_ABOVE
          : dim && dim.x > 0.5
            ? ICON_LEFT
            : ICON_RIGHT;
      placeIcon(
        { x: (shape.x1 + shape.x2) / 2, y: (shape.y1 + shape.y2) / 2 },
        dir,
        [c.shapeIdx],
        CONSTRAINT_HORIZONTAL_COLOR,
      );
    } else if (c.type === "parallel" || c.type === "colinear") {
      const a = shapes[c.shapeAIdx];
      if (!a || a.type !== "line") return;
      placeIcon(
        { x: (a.x1 + a.x2) / 2, y: (a.y1 + a.y2) / 2 },
        ICON_UP_RIGHT,
        [c.shapeAIdx, c.shapeBIdx],
        CONSTRAINT_ON_LINE_COLOR,
      );
    } else if (c.type === "centre") {
      addCentreConstraintIcon({
        c,
        shapes,
        toWorld,
        group,
        placeIcon,
        color: CONSTRAINT_ON_LINE_COLOR,
      });
    } else if (c.type === "midpoint") {
      // Beside the target's middle -- the pinned point sits exactly there.
      const m = shapeMidpoint(shapes[c.targetShapeIdx]);
      if (m)
        placeIcon(
          m,
          ICON_UP_RIGHT,
          [c.pointShapeIdx, c.targetShapeIdx],
          CONSTRAINT_ON_LINE_COLOR,
        );
    } else if (c.type === "tangent") {
      const a = shapes[c.shapeAIdx],
        b = shapes[c.shapeBIdx];
      const isArc = (s) => s?.type === "circle" || s?.type === "arc";
      // Anchor at (≈) the tangent point.
      let ax, ay;
      if (a?.type === "line" && isArc(b)) {
        const dx = a.x2 - a.x1,
          dy = a.y2 - a.y1,
          l2 = dx * dx + dy * dy || 1;
        const t = ((b.cx - a.x1) * dx + (b.cy - a.y1) * dy) / l2;
        ax = a.x1 + dx * t;
        ay = a.y1 + dy * t;
      } else if (isArc(a) && b?.type === "line") {
        const dx = b.x2 - b.x1,
          dy = b.y2 - b.y1,
          l2 = dx * dx + dy * dy || 1;
        const t = ((a.cx - b.x1) * dx + (a.cy - b.y1) * dy) / l2;
        ax = b.x1 + dx * t;
        ay = b.y1 + dy * t;
      } else if (isArc(a) && isArc(b)) {
        const dx = b.cx - a.cx,
          dy = b.cy - a.cy,
          d = Math.hypot(dx, dy) || 1;
        ax = a.cx + (dx / d) * (a.r || 0);
        ay = a.cy + (dy / d) * (a.r || 0);
      } else return;
      placeIcon(
        { x: ax, y: ay },
        ICON_UP_RIGHT,
        [c.shapeAIdx, c.shapeBIdx],
        CONSTRAINT_ON_LINE_COLOR,
      );
    } else if (c.type === "equal") {
      // One on each equal entity: beside a line's middle, or a ring's top.
      for (const e of [shapes[c.shapeAIdx], shapes[c.shapeBIdx]]) {
        const at =
          e?.type === "line"
            ? { x: (e.x1 + e.x2) / 2, y: (e.y1 + e.y2) / 2 }
            : e?.type === "circle" || e?.type === "arc"
              ? { x: e.cx, y: e.cy + (e.r || 0) }
              : null;
        if (at)
          placeIcon(
            at,
            ICON_UP_RIGHT,
            [c.shapeAIdx, c.shapeBIdx],
            CONSTRAINT_ON_LINE_COLOR,
          );
      }
    } else if (c.type === "text") {
      // Double-click either marker to re-open the primitive's dialog.
      addTextConstraintIcon({
        c,
        shapes,
        toWorld,
        group,
        tag,
        markFixedSize,
        R,
      });
    } else if (c.type === "cog") {
      addCogConstraintIcon({ c, shapes, placeIcon });
    } else if (c.type === "angle") {
      const sA = shapes[c.shapeAIdx],
        sB = shapes[c.shapeBIdx];
      if (!sA || sA.type !== "line" || !sB || sB.type !== "line") return;
      const P = getShapePoint(sA, c.pointA);
      const oA = getShapePoint(sA, c.pointA === "start" ? "end" : "start");
      const oB = getShapePoint(sB, c.pointB === "start" ? "end" : "start");
      if (!P || !oA || !oB) return;
      const aF = Math.atan2(oA.y - P.y, oA.x - P.x);
      let delta = Math.atan2(oB.y - P.y, oB.x - P.x) - aF;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      const AR = 0.45;
      const arcPts = [];
      for (let s = 0; s <= 16; s++) {
        const ang = aF + delta * (s / 16);
        arcPts.push(
          toWorld(P.x + Math.cos(ang) * AR, P.y + Math.sin(ang) * AR, 0.005),
        );
      }
      const arc = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(arcPts),
        new THREE.LineBasicMaterial({
          color: CONSTRAINT_ANGLE_COLOR,
          depthTest: false,
        }),
      );
      arc.renderOrder = 1004;
      tag(
        arc,
        { x: P.x, y: P.y },
        [c.shapeAIdx, c.shapeBIdx],
        CONSTRAINT_ANGLE_COLOR,
      );
      group.add(arc);
      markFixedSize(arc, toWorld(P.x, P.y, 0.005));
      if (showDimensions) {
        const deg = typeof c.angle === "number" ? c.angle : parseFloat(c.angle);
        // Same builder as every other dimension label so the font size matches;
        // angle keeps its own colour and carries no formula prefix.
        const sprite = makeDimLabelSprite(`${Math.round(deg)}°`, {
          theme,
          color: ANGLE_LABEL_TEXT,
        });
        const midAng = aF + delta / 2;
        sprite.position.copy(
          toWorld(
            P.x + Math.cos(midAng) * (AR + 0.3),
            P.y + Math.sin(midAng) * (AR + 0.3),
            0.006,
          ),
        );
        sprite.renderOrder = 1009;
        addTagged(sprite);
      }
    } else if (c.type === "offset") {
      if (c.offsetGroup != null) {
        if (seenOffsetGroups.has(c.offsetGroup)) return;
        seenOffsetGroups.add(c.offsetGroup);
      }
      const nl = shapes[c.shapeIdx];
      const ol = shapes[c.origIdx];
      if (!nl || (nl.type !== "line" && nl.type !== "circle")) return;
      // The technical dimension + tick ends, drawn across the offset gap; the
      // label then sits on that dimension line.
      let labelLocal;
      // Shared: build a grey dimension line wA→wB (slightly over-run) with a
      // tick at each end, and use its midpoint (in sketch-local) as the label.
      const drawGap = (aLocal, bLocal) => {
        const wA = toWorld(aLocal.x, aLocal.y, 0.006);
        const wB = toWorld(bLocal.x, bLocal.y, 0.006);
        const dimDir = new THREE.Vector3().subVectors(wB, wA).normalize();
        const tickPerp = sketchNormal.clone().cross(dimDir).normalize();
        const OVER = 0.14;
        const dimLine = addDimSeg(
          wA.clone().addScaledVector(dimDir, -OVER),
          wB.clone().addScaledVector(dimDir, OVER),
        );
        addDimTick(wA, tickPerp);
        addDimTick(wB, tickPerp);
        labelLocal = {
          x: (aLocal.x + bLocal.x) / 2,
          y: (aLocal.y + bLocal.y) / 2,
        };
        // The dimension line is a double-click hotspot too.
        tag(dimLine, labelLocal, [c.shapeIdx, c.origIdx], dimColor);
      };
      if (nl.type === "circle") {
        // Concentric offset: a radial dimension from the original circle's edge
        // out to the offset copy's edge, at a fixed pleasant angle.
        const rO = ol?.type === "circle" ? (ol.r ?? 0) : (nl.r ?? 0);
        const rN = nl.r ?? 0;
        const ux = Math.cos(Math.PI / 4),
          uy = Math.sin(Math.PI / 4);
        const pO = { x: nl.cx + rO * ux, y: nl.cy + rO * uy };
        const pN = { x: nl.cx + rN * ux, y: nl.cy + rN * uy };
        labelLocal = { x: (pO.x + pN.x) / 2, y: (pO.y + pN.y) / 2 };
        if (Math.abs(rN - rO) > 1e-4) drawGap(pO, pN);
      } else {
        // Linear offset: a dimension perpendicular from the ORIGINAL line to the
        // offset copy's midpoint.
        const midLocal = { x: (nl.x1 + nl.x2) / 2, y: (nl.y1 + nl.y2) / 2 };
        labelLocal = midLocal;
        if (ol && ol.type === "line") {
          const oLen = Math.hypot(ol.x2 - ol.x1, ol.y2 - ol.y1) || 1;
          const odx = (ol.x2 - ol.x1) / oLen,
            ody = (ol.y2 - ol.y1) / oLen;
          // Foot of the offset line's midpoint projected onto the original.
          const t = (midLocal.x - ol.x1) * odx + (midLocal.y - ol.y1) * ody;
          const footLocal = { x: ol.x1 + odx * t, y: ol.y1 + ody * t };
          if (
            Math.hypot(midLocal.x - footLocal.x, midLocal.y - footLocal.y) >
            1e-4
          )
            drawGap(footLocal, midLocal);
        }
      }
      // Signed value: the sign of the offset distance is meaningful (which
      // side the copy sits on), so keep it on the label.
      const valueMm = (resolveConstraintDistance(c) * MM_PER_UNIT).toFixed(1);
      const sprite = makeDimLabelSprite(`${valueMm}mm`, {
        theme,
        isFormula: isFormulaValue(c.distance),
        color: toCssHex(dimColor),
      });
      sprite.position.copy(toWorld(labelLocal.x, labelLocal.y, 0.006));
      // Tag with the icon's local position so the double-click hit-test can
      // find it and open the edit overlay.
      tag(sprite, labelLocal, [c.shapeIdx, c.origIdx], dimColor);
      group.add(sprite);
    } else if (c.type === "mirror") {
      // Small fixed-size X glyph midway between the original's and the
      // copy's reference points — click-select to enable Delete, which
      // breaks the mirror link via the generic deleteSketchConstraint flow.
      const orig = shapes[c.origIdx];
      const copy = shapes[c.shapeIdx];
      if (!orig || !copy) return;
      const key =
        orig.type === "line"
          ? "start"
          : orig.type === "bezier"
            ? "p0"
            : "center";
      const pA = getShapePoint(orig, key);
      const pB = getShapePoint(copy, key);
      if (!pA || !pB) return;
      const mid = { x: (pA.x + pB.x) / 2, y: (pA.y + pB.y) / 2 };
      const cross = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints([
          toWorld(mid.x - R, mid.y - R, 0.005),
          toWorld(mid.x + R, mid.y + R, 0.005),
          toWorld(mid.x - R, mid.y + R, 0.005),
          toWorld(mid.x + R, mid.y - R, 0.005),
        ]),
        new THREE.LineBasicMaterial({
          color: sketchMirrorColorFor(theme),
          depthTest: false,
        }),
      );
      cross.renderOrder = 1004;
      tag(
        cross,
        mid,
        [c.shapeIdx, c.origIdx, c.lineIdx],
        sketchMirrorColorFor(theme),
      );
      group.add(cross);
      markFixedSize(cross, toWorld(mid.x, mid.y, 0.005));
    } else if (c.type === "circularPattern") {
      // Small fixed-size diamond at the copy's reference point — click-select
      // to enable Delete, which breaks this copy's link via the generic
      // deleteSketchConstraint flow.
      const orig = shapes[c.origIdx];
      const copy = shapes[c.shapeIdx];
      if (!orig || !copy) return;
      const key =
        orig.type === "line"
          ? "start"
          : orig.type === "bezier"
            ? "p0"
            : "center";
      const pB = getShapePoint(copy, key);
      if (!pB) return;
      placeIcon(
        pB,
        ICON_UP_RIGHT,
        [c.shapeIdx, c.origIdx, c.centerShapeIdx],
        sketchCircularPatternColorFor(theme),
      );
    } else if (c.type === "rectangularPattern") {
      // Small fixed-size square at the copy's reference point — click-select
      // to enable Delete, which breaks this copy's link via the generic
      // deleteSketchConstraint flow.
      const orig = shapes[c.origIdx];
      const copy = shapes[c.shapeIdx];
      if (!orig || !copy) return;
      const key =
        orig.type === "line"
          ? "start"
          : orig.type === "bezier"
            ? "p0"
            : "center";
      const pB = getShapePoint(copy, key);
      if (!pB) return;
      const square = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          toWorld(pB.x - R, pB.y - R, 0.005),
          toWorld(pB.x + R, pB.y - R, 0.005),
          toWorld(pB.x + R, pB.y + R, 0.005),
          toWorld(pB.x - R, pB.y + R, 0.005),
        ]),
        new THREE.LineBasicMaterial({
          color: sketchRectangularPatternColorFor(theme),
          depthTest: false,
        }),
      );
      square.renderOrder = 1004;
      tag(
        square,
        pB,
        [c.shapeIdx, c.origIdx],
        sketchRectangularPatternColorFor(theme),
      );
      group.add(square);
      markFixedSize(square, toWorld(pB.x, pB.y, 0.005));
    }
  });
}

// Removes existing constraint icon objects from the group and rebuilds them
// based on the provided current shapes (used during drag to keep icons live).
export function rebuildConstraintIconsForDrag(
  group,
  constraints,
  shapes,
  sketchMesh,
  renderer,
  showDimensions = true,
  showConstraints = true,
) {
  const toRemove = group.children.filter((c) => c.userData.isConstraintObj);
  toRemove.forEach((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (obj.material.map) obj.material.map.dispose();
      obj.material.dispose();
    }
    group.remove(obj);
  });
  if (!constraints.length) return;
  const res = renderer
    ? renderer.getSize(new THREE.Vector2())
    : new THREE.Vector2(window.innerWidth, window.innerHeight);
  const toWorld = (lx, ly, z = 0.003) => {
    const v = new THREE.Vector3(lx, ly, z);
    v.applyQuaternion(sketchMesh.quaternion);
    v.add(sketchMesh.position);
    return v;
  };
  addConstraintIconsToGroup(
    group,
    constraints,
    shapes,
    toWorld,
    res,
    showDimensions,
    null,
    showConstraints,
  );
}
