// Sketch overlays: the always-on object-view lines that show every
// sketch, the per-sketch loop fills used to pick an extrude profile,
// and the in-sketch edit overlay (lines + endpoint dots + constraint
// icons + hole-aware region fills) used when a sketch is active.

import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import {
  addConstraintIconsToGroup,
  makeDimLabelSprite,
  isFormulaValue,
} from "./constraintIcons.js";
import { getSketchShapePoints, getSnapPoints } from "./sketchShapes.js";
import { shapeMidpoint } from "../sketchGeometry.js";
import { trackScreenDash } from "../screenDash.js";
import { MM_PER_UNIT } from "./dimensions.js";
import { textShapeContours } from "../sketchText.js";
import { cogShapeContours } from "../cogGeometry.js";

// Text and cogs are drawn from their cached outline contours -- several closed
// loops per shape (glyph counters, a cog's centre hole) -- not from one
// polyline like the other shapes.
const contourShape = (s) => s.type === "text" || s.type === "cog";
const shapeContours = (s) =>
  s.type === "cog" ? cogShapeContours(s) : textShapeContours(s);
import { useStore } from "../../store";
import {
  findClosedLoopsWithShapes,
  groupLoopsWithHoles,
  polyCentroid,
} from "./closedLoops.js";
import {
  SKETCH_FACE_HIGHLIGHT,
  sketchConstructionColorFor,
  sketchLineColorFor,
  sketchNodeColorFor,
  sketchOffsetColorFor,
  sketchMirrorColorFor,
  sketchCircularPatternColorFor,
  sketchRectangularPatternColorFor,
} from "../theme.js";

// Offset copies (driven by an offset constraint) render in OFFSET_COLOR to
// set them apart from ordinary sketch geometry — and are made non-interactive
// so they can't be edited/dragged on their own while the constraint holds.
const offsetShapeIdxSet = (item) =>
  new Set(
    (item.constraints || [])
      .filter((c) => c.type === "offset")
      .map((c) => c.shapeIdx),
  );

// Mirror copies (driven by a mirror constraint) render in MIRROR_COLOR and
// are made non-interactive while the constraint holds — same rationale as
// offset copies.
const mirrorShapeIdxSet = (item) =>
  new Set(
    (item.constraints || [])
      .filter((c) => c.type === "mirror")
      .map((c) => c.shapeIdx),
  );

// Circular-pattern copies (driven by a circularPattern constraint) render in
// CIRCULAR_PATTERN_COLOR and are non-interactive while the constraint holds —
// same rationale as offset/mirror copies.
const circularPatternShapeIdxSet = (item) =>
  new Set(
    (item.constraints || [])
      .filter((c) => c.type === "circularPattern")
      .map((c) => c.shapeIdx),
  );

// Rectangular-pattern copies (driven by a rectangularPattern constraint)
// render in RECTANGULAR_PATTERN_COLOR and are non-interactive while the
// constraint holds — same rationale as offset/mirror/circular-pattern copies.
const rectangularPatternShapeIdxSet = (item) =>
  new Set(
    (item.constraints || [])
      .filter((c) => c.type === "rectangularPattern")
      .map((c) => c.shapeIdx),
  );

// The copy shapes of the mirror / pattern currently being edited (double-click
// → beginXEdit stamps editCopyIndices on the active tool's state).  These are
// hidden while editing so the live preview shows source + preview only, like
// the initial creation.  Empty when no edit is in progress on this sketch.
const editHiddenShapeIdxSet = (sketchId) => {
  const s = useStore.getState();
  if (s.selectedId !== sketchId) return new Set();
  const st =
    s.activeSketchTool === "mirror"
      ? s.sketchMirrorState
      : s.activeSketchTool === "circularPattern"
        ? s.sketchCircularPatternState
        : s.activeSketchTool === "rectangularPattern"
          ? s.sketchRectangularPatternState
          : null;
  return new Set(st?.editCopyIndices || []);
};

// ── Object-view sketch lines (all sketches, lines only) ──────────────────────

export function buildAllSketchShapesGroup(items, objectsRef, renderer) {
  const sketchItems = items.filter(
    (item) =>
      item.type === "sketch" &&
      item.shapes?.length > 0 &&
      item.visible !== false,
  );
  if (sketchItems.length === 0) return null;

  const group = new THREE.Group();
  const res = renderer
    ? renderer.getSize(new THREE.Vector2())
    : new THREE.Vector2(window.innerWidth, window.innerHeight);

  const theme = useStore.getState().theme;
  sketchItems.forEach((item) => {
    const sketchMesh = objectsRef.current[item.id];
    if (!sketchMesh) return;
    const offsetIdxs = offsetShapeIdxSet(item);
    const mirrorIdxs = mirrorShapeIdxSet(item);
    const circularPatternIdxs = circularPatternShapeIdxSet(item);
    const rectangularPatternIdxs = rectangularPatternShapeIdxSet(item);
    item.shapes.forEach((shape, shapeIdx) => {
      if (contourShape(shape)) {
        const toW = (lx, ly) =>
          new THREE.Vector3(lx, ly, 0.003)
            .applyQuaternion(sketchMesh.quaternion)
            .add(sketchMesh.position);
        for (const contour of shapeContours(shape)) {
          if (contour.length < 2) continue;
          const wpts = [...contour, contour[0]].map((p) => toW(p.x, p.y));
          const tgeo = new LineGeometry();
          tgeo.setPositions(wpts.flatMap((p) => [p.x, p.y, p.z]));
          const tline = new Line2(
            tgeo,
            new LineMaterial({
              color: sketchLineColorFor(theme),
              linewidth: 1.5,
              depthTest: false,
              resolution: res,
            }),
          );
          tline.computeLineDistances();
          tline.renderOrder = 1001;
          group.add(tline);
        }
        return;
      }
      const pts = getSketchShapePoints(shape, sketchMesh);
      if (pts.length < 2) return;
      const geo = new LineGeometry();
      geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
      const mat = new LineMaterial({
        color: offsetIdxs.has(shapeIdx)
          ? sketchOffsetColorFor(theme)
          : mirrorIdxs.has(shapeIdx)
            ? sketchMirrorColorFor(theme)
            : circularPatternIdxs.has(shapeIdx)
              ? sketchCircularPatternColorFor(theme)
              : rectangularPatternIdxs.has(shapeIdx)
                ? sketchRectangularPatternColorFor(theme)
                : shape.dashed
                  ? sketchConstructionColorFor(theme)
                  : sketchLineColorFor(theme),
        linewidth: 1.5,
        depthTest: false,
        resolution: res,
        dashed: !!shape.dashed,
      });
      // Construction lines: the dash size is set per frame, in screen pixels.
      if (shape.dashed) trackScreenDash(mat);
      const line = new Line2(geo, mat);
      line.computeLineDistances();
      line.renderOrder = 1001;
      group.add(line);
    });
  });

  return group.children.length > 0 ? group : null;
}

// ── Extrude profile selection fills (one fill mesh per closed sketch loop) ───

// `alsoSketchIds`: sketches to offer even while hidden -- the ones an extrude
// being edited was built from.  Making an extrude can hide its sketch, and
// the edit shows the scene as of the extrude's own step, so without this the
// edit opened with no region to pick and Confirm stayed disabled.
export function buildExtrudeSelectGroup(
  items,
  objectsRef,
  curveSegments = 32,
  precision = null,
  alsoSketchIds = null,
) {
  const sketchItems = items.filter(
    (i) =>
      i.type === "sketch" &&
      i.shapes?.length > 0 &&
      (i.visible !== false || alsoSketchIds?.has(i.id)),
  );
  if (sketchItems.length === 0) return null;
  const group = new THREE.Group();
  sketchItems.forEach((item) => {
    const sketchMesh = objectsRef.current[item.id];
    if (!sketchMesh) return;
    const loopsWithShapes = findClosedLoopsWithShapes(
      item.shapes || [],
      curveSegments,
      precision,
    );
    // Track which loops belong to a text shape so its counters (e.g. the hole
    // in "o") stay holes of the glyph rather than separately-selectable regions.
    const textIdxs = new Set();
    (item.shapes || []).forEach((s, i) => {
      if (contourShape(s)) textIdxs.add(i);
    });
    const isTextPoly = new Map();
    const polyShapeIndices = new Map();
    const allLoops = loopsWithShapes.map((l) => {
      isTextPoly.set(
        l.polygon,
        l.shapeIndices.length > 0 &&
          l.shapeIndices.every((si) => textIdxs.has(si)),
      );
      polyShapeIndices.set(l.polygon, l.shapeIndices);
      return l.polygon;
    });
    const grouped = groupLoopsWithHoles(allLoops);
    const euler = new THREE.Euler().setFromQuaternion(sketchMesh.quaternion);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(
      sketchMesh.quaternion,
    );
    const pos = sketchMesh.position;
    const addProfile = ({ polygon, holes, entries }) => {
      if (polygon.length < 3) return;
      const shape = new THREE.Shape(
        polygon.map((p) => new THREE.Vector2(p.x, p.y)),
      );
      holes.forEach((hole) => {
        if (hole.length >= 3)
          shape.holes.push(
            new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y))),
          );
      });
      const fill = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({
          color: SKETCH_FACE_HIGHLIGHT,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          depthTest: false,
        }),
      );
      fill.position.copy(pos).addScaledVector(normal, 0.005);
      fill.quaternion.copy(sketchMesh.quaternion);
      fill.renderOrder = 995;
      // For a glyph loop, remember which text shape it came from so selecting
      // one letter can select the whole word (all glyphs share this index).
      const textShapeIdx = isTextPoly.get(polygon)
        ? (polyShapeIndices.get(polygon) || [])[0]
        : null;
      fill.userData.extrudeProfile = {
        type: "sketchLoop",
        sketchId: item.id,
        textShapeIdx: textShapeIdx ?? null,
        profileCentroid: polyCentroid(polygon),
        polygon2D: polygon,
        holes: holes.filter((h) => h.length >= 3),
        position: { x: pos.x, y: pos.y, z: pos.z },
        rotation: { x: euler.x, y: euler.y, z: euler.z },
        normalWorld: { x: normal.x, y: normal.y, z: normal.z },
      };
      group.add(fill);
      // A text glyph's nested regions are its counters — keep them as holes,
      // not separately-selectable profiles.  Non-text regions still expose
      // their children (e.g. text sitting inside a rectangle).
      if (!isTextPoly.get(polygon)) entries.forEach(addProfile);
    };
    grouped.forEach(addProfile);
  });
  return group.children.length > 0 ? group : null;
}

// ── Sketch shapes line group ─────────────────────────────────────────────────

// Update endpoint dots to track dragged shapes. Reuses the existing THREE.Points object
// and updates positions in-place when the count hasn't changed (the common drag case),
// avoiding per-frame geometry allocation and material creation.
export function rebuildPointDotsForDrag(group, shapes, sketchMesh) {
  const toWorld = (lx, ly) =>
    new THREE.Vector3(lx, ly, 0.004)
      .applyQuaternion(sketchMesh.quaternion)
      .add(sketchMesh.position);

  const pts = [];
  shapes.forEach((shape) =>
    getSnapPoints([shape]).forEach((sp) => pts.push(toWorld(sp.x, sp.y))),
  );

  const existing = group.children.find((c) => c.userData.isPointDots);
  if (existing && existing.geometry.attributes.position?.count === pts.length) {
    const pos = existing.geometry.attributes.position;
    pts.forEach((p, i) => pos.setXYZ(i, p.x, p.y, p.z));
    pos.needsUpdate = true;
    return;
  }

  // Count changed or no existing object — rebuild.
  if (existing) {
    existing.geometry.dispose();
    existing.material.dispose();
    group.remove(existing);
  }
  if (pts.length === 0) return;
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = new THREE.PointsMaterial({
    color: sketchNodeColorFor(useStore.getState().theme),
    size: 5,
    sizeAttenuation: false,
    depthTest: false,
  });
  const dots = new THREE.Points(geo, mat);
  dots.renderOrder = 1003;
  dots.userData.isPointDots = true;
  group.add(dots);
}

export function buildSketchShapesGroup(
  selectedId,
  items,
  objectsRef,
  renderer,
  showConstraints = true,
  showDimensions = true,
  curveSegments = 32,
  precision = null,
) {
  const selItem = items.find((i) => i.id === selectedId);
  if (selItem?.type !== "sketch") return null;
  const sketchMesh = objectsRef.current[selectedId];
  if (!sketchMesh) return null;
  const shapes = selItem.shapes || [];
  if (shapes.length === 0) return null;

  const group = new THREE.Group();
  const res = renderer
    ? renderer.getSize(new THREE.Vector2())
    : new THREE.Vector2(window.innerWidth, window.innerHeight);
  const theme = useStore.getState().theme;

  const toWorld = (lx, ly, z = 0.003) => {
    const v = new THREE.Vector3(lx, ly, z);
    v.applyQuaternion(sketchMesh.quaternion);
    v.add(sketchMesh.position);
    return v;
  };

  // While editing a mirror / pattern, its existing copies are hidden so the
  // live preview reads like the initial creation (source + preview only).
  const editHidden = editHiddenShapeIdxSet(selItem.id);

  // ── Shape lines (Line2 for actual pixel-width thickness) ──────────────────
  const offsetIdxs = offsetShapeIdxSet(selItem);
  const mirrorIdxs = mirrorShapeIdxSet(selItem);
  const circularPatternIdxs = circularPatternShapeIdxSet(selItem);
  const rectangularPatternIdxs = rectangularPatternShapeIdxSet(selItem);
  const dotWorldPts = [];
  shapes.forEach((shape, shapeIdx) => {
    if (editHidden.has(shapeIdx)) return;
    if (contourShape(shape)) {
      // Locked text / a cog: draw each contour as its own loop, all tagged with
      // the same shapeIdx so a click selects (and whole-shape drags) the shape.
      for (const contour of shapeContours(shape)) {
        if (contour.length < 2) continue;
        const wpts = [...contour, contour[0]].map((p) =>
          toWorld(p.x, p.y, 0.003),
        );
        const tgeo = new LineGeometry();
        tgeo.setPositions(wpts.flatMap((p) => [p.x, p.y, p.z]));
        const tline = new Line2(
          tgeo,
          new LineMaterial({
            color: sketchLineColorFor(theme),
            linewidth: 1.5,
            depthTest: false,
            resolution: res,
          }),
        );
        tline.computeLineDistances();
        tline.renderOrder = 1001;
        tline.userData.shapeIdx = shapeIdx;
        tline.userData.isText = shape.type === "text";
        group.add(tline);
      }
      return;
    }
    const pts = getSketchShapePoints(shape, sketchMesh);
    if (pts.length < 2) {
      // A standalone point has no polyline; still emit its node dot so it's
      // visible and pickable.
      if (shape.type === "point")
        getSnapPoints([shape]).forEach((sp) =>
          dotWorldPts.push(toWorld(sp.x, sp.y, 0.004)),
        );
      return;
    }

    // A bevel (fillet) arc is real profile geometry, so it draws like any other
    // solid sketch line — not as a dashed reference curve.
    const isDashed = !!shape.dashed;
    const isOffset = offsetIdxs.has(shapeIdx);
    const isMirror = mirrorIdxs.has(shapeIdx);
    const isCircularPattern = circularPatternIdxs.has(shapeIdx);
    const isRectangularPattern = rectangularPatternIdxs.has(shapeIdx);
    // Projected geometry is locked to its 3D source — drawn in a distinct teal
    // and (like the other constrained copies) inert to dragging.
    const isProjected = !!shape.projection;
    const isInert =
      isOffset ||
      isMirror ||
      isCircularPattern ||
      isRectangularPattern ||
      isProjected;
    const geo = new LineGeometry();
    geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    const mat = new LineMaterial({
      color: isProjected
        ? 0x37b8a0
        : isOffset
          ? sketchOffsetColorFor(theme)
          : isMirror
            ? sketchMirrorColorFor(theme)
            : isCircularPattern
              ? sketchCircularPatternColorFor(theme)
              : isRectangularPattern
                ? sketchRectangularPatternColorFor(theme)
                : sketchLineColorFor(theme),
      linewidth: 1.5,
      depthTest: false,
      resolution: res,
      transparent: isDashed,
      opacity: isDashed ? 0.75 : 1.0,
      dashed: isDashed,
    });
    if (isDashed) trackScreenDash(mat);
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 1001;
    line.userData.shapeIdx = shapeIdx;
    // Offset / mirror / circular-pattern / rectangular-pattern copies are
    // inert while constrained: tag so the drag / select hit-tests skip them
    // (they're driven by their original).
    if (isOffset) line.userData.isOffset = true;
    if (isMirror) line.userData.isMirror = true;
    if (isCircularPattern) line.userData.isCircularPattern = true;
    if (isRectangularPattern) line.userData.isRectangularPattern = true;
    if (isProjected) line.userData.isProjected = true;
    // Chamfer/bevel corner bridges are derived — inert to select / drag /
    // constraint hit-tests (their setback is edited via the value label).
    if (shape.kind === "chamfer" || shape.kind === "bevel")
      line.userData.isCornerBridge = true;
    group.add(line);

    // Collect key points for dots — not for offset/mirror/circular-pattern
    // copies, whose points are inert (a dot would imply a draggable handle
    // that does nothing).
    if (!isInert)
      getSnapPoints([shape]).forEach((sp) =>
        dotWorldPts.push(toWorld(sp.x, sp.y, 0.004)),
      );
  });

  // ── Point dots ────────────────────────────────────────────────────────────
  if (dotWorldPts.length > 0) {
    const ptGeo = new THREE.BufferGeometry().setFromPoints(dotWorldPts);
    const ptMat = new THREE.PointsMaterial({
      color: sketchNodeColorFor(theme),
      size: 5,
      sizeAttenuation: false,
      depthTest: false,
    });
    const dots = new THREE.Points(ptGeo, ptMat);
    dots.renderOrder = 1003;
    dots.userData.isPointDots = true;
    group.add(dots);
  }

  // ── Chamfer / bevel value labels ────────────────────────────────────────
  // Each corner bridge shows its setback / radius like a dimension label;
  // clicking the label re-opens the resize input (isCornerDim hit-tested in
  // sketchInteraction's click path).
  if (showDimensions) {
    const theme = useStore.getState().theme;
    shapes.forEach((shape, shapeIdx) => {
      if (shape.kind !== "chamfer" && shape.kind !== "bevel") return;
      const isBevel = shape.kind === "bevel";
      const valueUnits = isBevel ? shape.r : shape.chamferData?.dist;
      if (!Number.isFinite(valueUnits)) return;
      const mid = shapeMidpoint(shape);
      if (!mid) return;
      const valueMm = (valueUnits * MM_PER_UNIT).toFixed(1);
      const sprite = makeDimLabelSprite(`${isBevel ? "R " : ""}${valueMm}mm`, {
        theme,
        isFormula: isFormulaValue(shape.distanceFormula),
      });
      // Park the label just off the bridge: a bevel offsets radially outward
      // from its arc centre; a chamfer along its line normal.
      let off = { x: 0, y: 0.35 };
      if (isBevel) {
        const dx = mid.x - shape.cx,
          dy = mid.y - shape.cy;
        const len = Math.hypot(dx, dy) || 1;
        off = { x: (dx / len) * 0.45, y: (dy / len) * 0.45 };
      } else {
        const dx = shape.x2 - shape.x1,
          dy = shape.y2 - shape.y1;
        const len = Math.hypot(dx, dy) || 1;
        off = { x: (-dy / len) * 0.4, y: (dx / len) * 0.4 };
      }
      const localPos = { x: mid.x + off.x, y: mid.y + off.y };
      sprite.position.copy(toWorld(localPos.x, localPos.y, 0.007));
      sprite.renderOrder = 1009;
      sprite.frustumCulled = false;
      sprite.userData.isCornerDim = true;
      sprite.userData.shapeIdx = shapeIdx;
      sprite.userData.cornerDimLocalPos = localPos;
      group.add(sprite);
    });
  }

  // ── Constraint icons ──────────────────────────────────────────────────────
  const constraints = selItem.constraints || [];
  if (showConstraints || showDimensions)
    addConstraintIconsToGroup(
      group,
      constraints,
      shapes,
      toWorld,
      res,
      showDimensions,
      editHidden,
      showConstraints,
    );

  // ── Enclosed region fills (hole-aware, hidden until hover) ──────────────────
  const loopsWithShapes = findClosedLoopsWithShapes(
    shapes,
    curveSegments,
    precision,
  );
  if (loopsWithShapes.length > 0) {
    const polygons = loopsWithShapes.map((l) => l.polygon);
    const polyShapeMap = new Map(
      loopsWithShapes.map((l) => [l.polygon, l.shapeIndices]),
    );
    const grouped = groupLoopsWithHoles(polygons);

    // Recursive fill builder — each nesting level gets renderOrder + 1, ensuring
    // the innermost matching region always wins in updateHoverFills.
    const addRegionFill = ({ polygon, holes, entries }, renderOrder) => {
      if (polygon.length < 3) return;
      const outerIndices = polyShapeMap.get(polygon) || [];
      const holeIndices = holes.flatMap((h) => polyShapeMap.get(h) || []);
      const allShapeIndices = [...new Set([...outerIndices, ...holeIndices])];
      const shape2D = new THREE.Shape(
        polygon.map((p) => new THREE.Vector2(p.x, p.y)),
      );
      holes.forEach((hole) => {
        if (hole.length >= 3)
          shape2D.holes.push(
            new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y))),
          );
      });
      const fillMesh = new THREE.Mesh(
        new THREE.ShapeGeometry(shape2D),
        new THREE.MeshBasicMaterial({
          color: SKETCH_FACE_HIGHLIGHT,
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
          depthTest: false,
        }),
      );
      fillMesh.position.copy(sketchMesh.position);
      fillMesh.quaternion.copy(sketchMesh.quaternion);
      fillMesh.renderOrder = renderOrder;
      fillMesh.visible = false;
      fillMesh.userData.isRegionFill = true;
      fillMesh.userData.polygon2D = polygon;
      fillMesh.userData.holes2D = holes;
      fillMesh.userData.shapeIndices = allShapeIndices;
      group.add(fillMesh);
      // Each child entry is itself a selectable region at a higher renderOrder.
      entries.forEach((sub) => addRegionFill(sub, renderOrder + 1));
    };
    grouped.forEach((entry) => addRegionFill(entry, 999));
  }

  return group;
}
