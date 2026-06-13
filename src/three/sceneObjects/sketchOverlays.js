// Sketch overlays: the always-on object-view lines that show every
// sketch, the per-sketch loop fills used to pick an extrude profile,
// and the in-sketch edit overlay (lines + endpoint dots + constraint
// icons + hole-aware region fills) used when a sketch is active.

import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { addConstraintIconsToGroup } from "./constraintIcons.js";
import { getSketchShapePoints, getSnapPoints } from "./sketchShapes.js";
import { useStore } from "../../store";
import {
  findClosedLoops,
  findClosedLoopsWithShapes,
  groupLoopsWithHoles,
  polyCentroid,
} from "./closedLoops.js";
import {
  BEVEL_COLOR,
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
      if (shape.kind === "bevel") return; // bevel arcs not shown in object view
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
        dashSize: shape.dashed ? 0.1 : 0,
        gapSize: shape.dashed ? 0.06 : 0,
      });
      const line = new Line2(geo, mat);
      line.computeLineDistances();
      line.renderOrder = 1001;
      group.add(line);
    });
  });

  return group.children.length > 0 ? group : null;
}

// ── Extrude profile selection fills (one fill mesh per closed sketch loop) ───

export function buildExtrudeSelectGroup(
  items,
  objectsRef,
  curveSegments = 32,
  precision = null,
) {
  const sketchItems = items.filter(
    (i) => i.type === "sketch" && i.shapes?.length > 0 && i.visible !== false,
  );
  if (sketchItems.length === 0) return null;
  const group = new THREE.Group();
  sketchItems.forEach((item) => {
    const sketchMesh = objectsRef.current[item.id];
    if (!sketchMesh) return;
    const allLoops = findClosedLoops(
      item.shapes || [],
      curveSegments,
      precision,
    );
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
      fill.userData.extrudeProfile = {
        type: "sketchLoop",
        sketchId: item.id,
        profileCentroid: polyCentroid(polygon),
        polygon2D: polygon,
        holes: holes.filter((h) => h.length >= 3),
        position: { x: pos.x, y: pos.y, z: pos.z },
        rotation: { x: euler.x, y: euler.y, z: euler.z },
        normalWorld: { x: normal.x, y: normal.y, z: normal.z },
      };
      group.add(fill);
      entries.forEach(addProfile);
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

  // ── Shape lines (Line2 for actual pixel-width thickness) ──────────────────
  const offsetIdxs = offsetShapeIdxSet(selItem);
  const mirrorIdxs = mirrorShapeIdxSet(selItem);
  const circularPatternIdxs = circularPatternShapeIdxSet(selItem);
  const rectangularPatternIdxs = rectangularPatternShapeIdxSet(selItem);
  const dotWorldPts = [];
  shapes.forEach((shape, shapeIdx) => {
    const pts = getSketchShapePoints(shape, sketchMesh);
    if (pts.length < 2) return;

    const isBevel = shape.kind === "bevel";
    const isDashed = !!shape.dashed;
    const isOffset = offsetIdxs.has(shapeIdx);
    const isMirror = mirrorIdxs.has(shapeIdx);
    const isCircularPattern = circularPatternIdxs.has(shapeIdx);
    const isRectangularPattern = rectangularPatternIdxs.has(shapeIdx);
    const isInert =
      isOffset || isMirror || isCircularPattern || isRectangularPattern;
    const geo = new LineGeometry();
    geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    const mat = new LineMaterial({
      color: isBevel
        ? BEVEL_COLOR
        : isOffset
          ? sketchOffsetColorFor(theme)
          : isMirror
            ? sketchMirrorColorFor(theme)
            : isCircularPattern
              ? sketchCircularPatternColorFor(theme)
              : isRectangularPattern
                ? sketchRectangularPatternColorFor(theme)
                : sketchLineColorFor(theme),
      linewidth: isBevel ? 1.0 : 1.5,
      depthTest: false,
      resolution: res,
      transparent: isBevel || isDashed,
      opacity: isBevel ? 0.55 : isDashed ? 0.75 : 1.0,
      dashed: isDashed || isBevel,
      dashSize: isDashed || isBevel ? 0.1 : 0,
      gapSize: isDashed || isBevel ? 0.06 : 0,
    });
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

  // ── Constraint icons ──────────────────────────────────────────────────────
  const constraints = selItem.constraints || [];
  if (showConstraints)
    addConstraintIconsToGroup(
      group,
      constraints,
      shapes,
      toWorld,
      res,
      showDimensions,
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
