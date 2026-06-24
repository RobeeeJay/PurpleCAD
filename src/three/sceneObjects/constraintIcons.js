// Constraint icon overlays: builds the little THREE.js glyphs (coincident
// diamonds, distance dimension lines + labels, on-line ticks, H/V diamonds,
// angle arcs + degree labels) shown for each sketch constraint, plus the
// drag-time rebuild.  Split out of sketchOverlays.js to keep that file focused
// on the shape/region geometry.

import * as THREE from "three";
import { MM_PER_UNIT } from "./dimensions.js";
import { resolveConstraintDistance } from "../geometryParams.js";
import { getShapePoint } from "./sketchShapes.js";
import { useStore } from "../../store";
import {
  ANGLE_LABEL_BG,
  ANGLE_LABEL_TEXT,
  CONSTRAINT_ANGLE_COLOR,
  CONSTRAINT_COINCIDENT_COLOR,
  CONSTRAINT_HORIZONTAL_COLOR,
  CONSTRAINT_ON_LINE_COLOR,
  dimLabelBgFor,
  dimLineColorFor,
  dimValueColorFor,
  sketchMirrorColorFor,
  sketchCircularPatternColorFor,
  sketchRectangularPatternColorFor,
  toCssHex,
} from "../theme.js";

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
          color: dimLineColorFor(theme),
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
          color: dimLineColorFor(theme),
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
      const cLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          toWorld(pt.x, pt.y + R, 0.005),
          toWorld(pt.x + R, pt.y, 0.005),
          toWorld(pt.x, pt.y - R, 0.005),
          toWorld(pt.x - R, pt.y, 0.005),
          toWorld(pt.x, pt.y + R, 0.005),
        ]),
        new THREE.LineBasicMaterial({
          color: CONSTRAINT_COINCIDENT_COLOR,
          depthTest: false,
        }),
      );
      cLine.renderOrder = 1004;
      tag(
        cLine,
        { x: pt.x, y: pt.y },
        [c.shapeAIdx, c.shapeBIdx],
        CONSTRAINT_COINCIDENT_COLOR,
      );
      group.add(cLine);
      markFixedSize(cLine, toWorld(pt.x, pt.y, 0.005));
    } else if (c.type === "distance") {
      if (!showDimensions) return;
      const sA = shapes[c.shapeAIdx],
        sB = shapes[c.shapeBIdx];
      if (!sA || !sB) return;
      const isRadius =
        c.shapeAIdx === c.shapeBIdx &&
        c.pointB === "edge" &&
        sA.type === "circle";
      const posA = getShapePoint(sA, c.pointA),
        posB = getShapePoint(sB, c.pointB);
      if (!posA || !posB) return;
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
      if (isRadius) {
        // Radius: leader from the centre out past the arc, tick at the arc.
        const wLineTo = wB.clone().addScaledVector(dir, 0.35);
        const leader = addDimSeg(wA, wLineTo);
        tag(
          leader,
          { x: (posA.x + posB.x) / 2, y: (posA.y + posB.y) / 2 },
          distShapes,
          dimLineColorFor(theme),
        );
        addDimTick(wB, perpU);
        labelPos = wLineTo.clone().addScaledVector(dir, 0.45);
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
          dimLineColorFor(theme),
        );
        addDimTick(A2, perpU);
        addDimTick(B2, perpU);
        labelPos = new THREE.Vector3().addVectors(A2, B2).multiplyScalar(0.5);
      }
      // c.distance may be a number or a formula string; evaluate before display.
      const resolvedDist = resolveConstraintDistance(c);
      // When the constraint's value is a formula (any string that isn't a
      // bare number), surface it on the label so the user can see which
      // variable / expression drives the dimension.  A bare-number string
      // ("10.5") is shown as just the mm value, matching the legacy look.
      const valueMm = (resolvedDist * MM_PER_UNIT).toFixed(1);
      const formulaSrc =
        typeof c.distance === "string" &&
        !/^-?\d+(\.\d+)?$/.test(c.distance.trim())
          ? c.distance.trim()
          : null;
      const labelText =
        (isRadius ? "R " : "") +
        (formulaSrc ? `${formulaSrc} = ${valueMm}mm` : `${valueMm}mm`);
      const canvas = document.createElement("canvas");
      const tmpCtx = canvas.getContext("2d");
      const labelFont = "bold 18px sans-serif";
      tmpCtx.font = labelFont;
      // Measure first so longer formula labels don't get clipped at the
      // edges; pad each side by 12px for the rounded background.
      const measured = tmpCtx.measureText(labelText).width;
      canvas.width = Math.max(160, Math.ceil(measured) + 24);
      canvas.height = 32;
      const ctx2d = canvas.getContext("2d");
      ctx2d.fillStyle = dimLabelBgFor(theme);
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      ctx2d.fillStyle = toCssHex(dimValueColorFor(theme));
      ctx2d.font = labelFont;
      ctx2d.textAlign = "center";
      ctx2d.textBaseline = "middle";
      ctx2d.fillText(labelText, canvas.width / 2, canvas.height / 2);
      const tex = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, depthTest: false }),
      );
      // Sprite world-size scales with the canvas's aspect ratio so longer
      // formula labels stay readable instead of being squished.
      const baseW = isRadius ? 0.85 : 0.7;
      const aspect = canvas.width / 160;
      sprite.scale.set(baseW * aspect, 0.175, 1);
      sprite.position.copy(labelPos);
      sprite.renderOrder = 1009;
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
      const mx = (shape.x1 + shape.x2) / 2,
        my = (shape.y1 + shape.y2) / 2;
      const cLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          toWorld(mx, my + R, 0.005),
          toWorld(mx + R, my, 0.005),
          toWorld(mx, my - R, 0.005),
          toWorld(mx - R, my, 0.005),
          toWorld(mx, my + R, 0.005),
        ]),
        new THREE.LineBasicMaterial({
          color: CONSTRAINT_HORIZONTAL_COLOR,
          depthTest: false,
        }),
      );
      cLine.renderOrder = 1004;
      tag(cLine, { x: mx, y: my }, [c.shapeIdx], CONSTRAINT_HORIZONTAL_COLOR);
      group.add(cLine);
      markFixedSize(cLine, toWorld(mx, my, 0.005));
    } else if (c.type === "parallel" || c.type === "colinear") {
      const a = shapes[c.shapeAIdx];
      if (!a || a.type !== "line") return;
      const mx = (a.x1 + a.x2) / 2,
        my = (a.y1 + a.y2) / 2;
      const ddx = a.x2 - a.x1,
        ddy = a.y2 - a.y1,
        len = Math.hypot(ddx, ddy) || 1;
      const ux = ddx / len,
        uy = ddy / len,
        px = -uy,
        py = ux;
      const pts = [];
      if (c.type === "parallel") {
        // Two short segments parallel to the line ("=" along it).
        const L = R * 0.8,
          off = R * 0.45;
        for (const s of [-1, 1])
          pts.push(
            toWorld(
              mx + px * off * s - ux * L,
              my + py * off * s - uy * L,
              0.005,
            ),
            toWorld(
              mx + px * off * s + ux * L,
              my + py * off * s + uy * L,
              0.005,
            ),
          );
      } else {
        // A segment along the line with a tick at each end (collinear marker).
        const L = R,
          t = R * 0.4;
        pts.push(
          toWorld(mx - ux * L, my - uy * L, 0.005),
          toWorld(mx + ux * L, my + uy * L, 0.005),
        );
        for (const s of [-1, 1])
          pts.push(
            toWorld(mx + ux * L * s + px * t, my + uy * L * s + py * t, 0.005),
            toWorld(mx + ux * L * s - px * t, my + uy * L * s - py * t, 0.005),
          );
      }
      const seg = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: CONSTRAINT_ON_LINE_COLOR,
          depthTest: false,
        }),
      );
      seg.renderOrder = 1004;
      tag(
        seg,
        { x: mx, y: my },
        [c.shapeAIdx, c.shapeBIdx],
        CONSTRAINT_ON_LINE_COLOR,
      );
      group.add(seg);
      markFixedSize(seg, toWorld(mx, my, 0.005));
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
      // A small circle resting on a tangent line.
      const r = R * 0.55;
      const pts = [];
      const N = 16;
      for (let i = 0; i < N; i++) {
        const t0 = (i / N) * 2 * Math.PI,
          t1 = ((i + 1) / N) * 2 * Math.PI;
        pts.push(
          toWorld(ax + Math.cos(t0) * r, ay + r + Math.sin(t0) * r, 0.005),
          toWorld(ax + Math.cos(t1) * r, ay + r + Math.sin(t1) * r, 0.005),
        );
      }
      pts.push(
        toWorld(ax - r * 1.4, ay, 0.005),
        toWorld(ax + r * 1.4, ay, 0.005),
      );
      const seg = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: CONSTRAINT_ON_LINE_COLOR,
          depthTest: false,
        }),
      );
      seg.renderOrder = 1004;
      tag(
        seg,
        { x: ax, y: ay },
        [c.shapeAIdx, c.shapeBIdx],
        CONSTRAINT_ON_LINE_COLOR,
      );
      group.add(seg);
      markFixedSize(seg, toWorld(ax, ay, 0.005));
    } else if (c.type === "equal") {
      // A matching double-tick marker on each equal entity: across the line
      // (equal length), or a small "=" by the ring (equal radius).
      const buildEq = (pts, cx, cy) => {
        const seg = new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(pts),
          new THREE.LineBasicMaterial({
            color: CONSTRAINT_ON_LINE_COLOR,
            depthTest: false,
          }),
        );
        seg.renderOrder = 1004;
        tag(
          seg,
          { x: cx, y: cy },
          [c.shapeAIdx, c.shapeBIdx],
          CONSTRAINT_ON_LINE_COLOR,
        );
        group.add(seg);
        markFixedSize(seg, toWorld(cx, cy, 0.005));
      };
      const mkEq = (s) => {
        if (!s) return;
        const pts = [];
        if (s.type === "line") {
          const cx = (s.x1 + s.x2) / 2,
            cy = (s.y1 + s.y2) / 2;
          const dx = s.x2 - s.x1,
            dy = s.y2 - s.y1,
            len = Math.hypot(dx, dy) || 1;
          const ux = dx / len,
            uy = dy / len,
            px = -uy,
            py = ux;
          const T = R * 0.7,
            gap = R * 0.3;
          for (const sgn of [-1, 1])
            pts.push(
              toWorld(
                cx + ux * gap * sgn - px * T,
                cy + uy * gap * sgn - py * T,
                0.005,
              ),
              toWorld(
                cx + ux * gap * sgn + px * T,
                cy + uy * gap * sgn + py * T,
                0.005,
              ),
            );
          buildEq(pts, cx, cy);
        } else if (s.type === "circle" || s.type === "arc") {
          const cx = s.cx,
            cy = s.cy + (s.r || 0) + R * 0.7;
          const L = R * 0.7,
            off = R * 0.3;
          for (const sgn of [-1, 1])
            pts.push(
              toWorld(cx - L, cy + off * sgn, 0.005),
              toWorld(cx + L, cy + off * sgn, 0.005),
            );
          buildEq(pts, cx, cy);
        }
      };
      mkEq(shapes[c.shapeAIdx]);
      mkEq(shapes[c.shapeBIdx]);
    } else if (c.type === "text") {
      // A small "T" mark at the text's top-left anchor — double-click to edit.
      const shape = shapes[c.shapeIdx];
      if (!shape || shape.type !== "text") return;
      const ax = shape.x,
        ay = shape.y;
      const tIcon = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          toWorld(ax - R, ay, 0.005),
          toWorld(ax + R, ay, 0.005),
          toWorld(ax, ay, 0.005),
          toWorld(ax, ay - 2 * R, 0.005),
        ]),
        new THREE.LineBasicMaterial({ color: 0x6c3fd4, depthTest: false }),
      );
      tIcon.renderOrder = 1004;
      tag(tIcon, { x: ax, y: ay }, [c.shapeIdx], 0x6c3fd4);
      group.add(tIcon);
      markFixedSize(tIcon, toWorld(ax, ay, 0.005));
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
        const labelText = `${Math.round(deg)}°`;
        const canvas = document.createElement("canvas");
        canvas.width = 96;
        canvas.height = 32;
        const ctx2d = canvas.getContext("2d");
        ctx2d.fillStyle = ANGLE_LABEL_BG;
        ctx2d.fillRect(0, 0, canvas.width, canvas.height);
        ctx2d.fillStyle = ANGLE_LABEL_TEXT;
        ctx2d.font = "bold 18px sans-serif";
        ctx2d.textAlign = "center";
        ctx2d.textBaseline = "middle";
        ctx2d.fillText(labelText, canvas.width / 2, canvas.height / 2);
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: new THREE.CanvasTexture(canvas),
            depthTest: false,
          }),
        );
        sprite.scale.set(0.45, 0.15, 1);
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
      if (!showDimensions) return;
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
        tag(
          dimLine,
          labelLocal,
          [c.shapeIdx, c.origIdx],
          dimLineColorFor(theme),
        );
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
      const resolvedDist = resolveConstraintDistance(c);
      const valueMm = (resolvedDist * MM_PER_UNIT).toFixed(1);
      const formulaSrc =
        typeof c.distance === "string" &&
        !/^-?\d+(\.\d+)?$/.test(c.distance.trim())
          ? c.distance.trim()
          : null;
      const labelText = formulaSrc
        ? `${formulaSrc} = ${valueMm}mm`
        : `${valueMm}mm`;
      const canvas = document.createElement("canvas");
      const tmpCtx = canvas.getContext("2d");
      const labelFont = "bold 18px sans-serif";
      tmpCtx.font = labelFont;
      const measured = tmpCtx.measureText(labelText).width;
      canvas.width = Math.max(160, Math.ceil(measured) + 24);
      canvas.height = 32;
      const ctx2d = canvas.getContext("2d");
      ctx2d.fillStyle = dimLabelBgFor(theme);
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      ctx2d.fillStyle = toCssHex(dimValueColorFor(theme));
      ctx2d.font = labelFont;
      ctx2d.textAlign = "center";
      ctx2d.textBaseline = "middle";
      ctx2d.fillText(labelText, canvas.width / 2, canvas.height / 2);
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: new THREE.CanvasTexture(canvas),
          depthTest: false,
        }),
      );
      sprite.scale.set(0.7 * (canvas.width / 160), 0.175, 1);
      sprite.position.copy(toWorld(labelLocal.x, labelLocal.y, 0.006));
      sprite.renderOrder = 1009;
      // Tag with the icon's local position so the double-click hit-test can
      // find it and open the edit overlay.
      tag(sprite, labelLocal, [c.shapeIdx, c.origIdx], dimLineColorFor(theme));
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
      const diamond = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          toWorld(pB.x, pB.y + R, 0.005),
          toWorld(pB.x + R, pB.y, 0.005),
          toWorld(pB.x, pB.y - R, 0.005),
          toWorld(pB.x - R, pB.y, 0.005),
          toWorld(pB.x, pB.y + R, 0.005),
        ]),
        new THREE.LineBasicMaterial({
          color: sketchCircularPatternColorFor(theme),
          depthTest: false,
        }),
      );
      diamond.renderOrder = 1004;
      tag(
        diamond,
        pB,
        [c.shapeIdx, c.origIdx, c.centerShapeIdx],
        sketchCircularPatternColorFor(theme),
      );
      group.add(diamond);
      markFixedSize(diamond, toWorld(pB.x, pB.y, 0.005));
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
  );
}
