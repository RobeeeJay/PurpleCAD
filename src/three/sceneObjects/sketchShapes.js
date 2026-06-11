// Sketch 2D shape primitives.  These functions operate on the JSON
// shape objects stored in `sketch.shapes` (line / rect / circle /
// ellipse / arc / bezier), and convert between local sketch
// coordinates and the world-space points needed for rendering or
// snap-testing.  No scene-state dependencies — every input is plain
// JS, every output is plain JS (or a freshly-built THREE vector).

import * as THREE from "three";
import { MM_PER_UNIT } from "./dimensions.js";

export function buildSketchShape(tool, start, current) {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const r = Math.sqrt(dx * dx + dy * dy);
  switch (tool) {
    case "rect":
      return {
        type: "rect",
        x1: start.x,
        y1: start.y,
        x2: current.x,
        y2: current.y,
      };
    case "circle":
      return { type: "circle", cx: start.x, cy: start.y, r };
    case "ellipse":
      return {
        type: "ellipse",
        cx: start.x,
        cy: start.y,
        rx: Math.abs(dx),
        ry: Math.abs(dy),
      };
    case "line":
      return {
        type: "line",
        x1: start.x,
        y1: start.y,
        x2: current.x,
        y2: current.y,
      };
    case "arc": {
      const startAngle = Math.atan2(dy, dx);
      return {
        type: "arc",
        cx: start.x,
        cy: start.y,
        r,
        startAngle,
        endAngle: startAngle + Math.PI / 2,
      };
    }
    default:
      return null;
  }
}

export function getSketchShapePoints(shape, sketchMesh) {
  const toWorld = (lx, ly) => {
    const v = new THREE.Vector3(lx, ly, 0.003);
    v.applyQuaternion(sketchMesh.quaternion);
    v.add(sketchMesh.position);
    return v;
  };
  switch (shape.type) {
    case "rect": {
      const { x1, y1, x2, y2 } = shape;
      return [
        toWorld(x1, y1),
        toWorld(x2, y1),
        toWorld(x2, y2),
        toWorld(x1, y2),
        toWorld(x1, y1),
      ];
    }
    case "circle": {
      const { cx, cy, r } = shape;
      return Array.from({ length: 65 }, (_, i) => {
        const a = (i / 64) * Math.PI * 2;
        return toWorld(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      });
    }
    case "ellipse": {
      const { cx, cy, rx, ry } = shape;
      return Array.from({ length: 65 }, (_, i) => {
        const a = (i / 64) * Math.PI * 2;
        return toWorld(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
      });
    }
    case "line":
      return [toWorld(shape.x1, shape.y1), toWorld(shape.x2, shape.y2)];
    case "arc": {
      const { cx, cy, r, startAngle, endAngle } = shape;
      return Array.from({ length: 33 }, (_, i) => {
        const a = startAngle + (i / 32) * (endAngle - startAngle);
        return toWorld(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      });
    }
    case "bezier": {
      const { p0, p1, p2, p3 } = shape;
      const curve = new THREE.CubicBezierCurve(
        new THREE.Vector2(p0.x, p0.y),
        new THREE.Vector2(p1.x, p1.y),
        new THREE.Vector2(p2.x, p2.y),
        new THREE.Vector2(p3.x, p3.y),
      );
      return curve.getPoints(48).map(({ x, y }) => toWorld(x, y));
    }
    default:
      return [];
  }
}

export function sketchDimText(tool, start, current) {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const L = Math.sqrt(dx * dx + dy * dy) * MM_PER_UNIT;
  const W = Math.abs(dx) * MM_PER_UNIT;
  const H = Math.abs(dy) * MM_PER_UNIT;
  switch (tool) {
    case "line":
      return `${L.toFixed(1)} mm`;
    case "arc":
      return `r ${L.toFixed(1)} mm`;
    case "circle":
      return `⌀ ${(L * 2).toFixed(1)} mm`;
    default:
      return `W ${W.toFixed(1)}  H ${H.toFixed(1)} mm`;
  }
}

export function moveShapePoint(shape, pointKey, newPos) {
  const { x, y } = newPos;
  switch (shape.type) {
    case "line":
      if (pointKey === "start") return { ...shape, x1: x, y1: y };
      if (pointKey === "end") return { ...shape, x2: x, y2: y };
      break;
    case "rect":
      if (pointKey === "tl") return { ...shape, x1: x, y1: y };
      if (pointKey === "tr") return { ...shape, x2: x, y1: y };
      if (pointKey === "br") return { ...shape, x2: x, y2: y };
      if (pointKey === "bl") return { ...shape, x1: x, y2: y };
      break;
    case "circle":
      if (pointKey === "center") return { ...shape, cx: x, cy: y };
      if (pointKey === "edge")
        return { ...shape, r: Math.hypot(x - shape.cx, y - shape.cy) };
      break;
    case "ellipse":
      if (pointKey === "center") return { ...shape, cx: x, cy: y };
      break;
    case "arc":
      if (pointKey === "center") return { ...shape, cx: x, cy: y };
      if (pointKey === "start") {
        // Translate the arc center so the start endpoint reaches (x, y),
        // preserving radius and angles.
        const dx = x - (shape.cx + Math.cos(shape.startAngle) * shape.r);
        const dy = y - (shape.cy + Math.sin(shape.startAngle) * shape.r);
        return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
      }
      if (pointKey === "end") {
        const dx = x - (shape.cx + Math.cos(shape.endAngle) * shape.r);
        const dy = y - (shape.cy + Math.sin(shape.endAngle) * shape.r);
        return { ...shape, cx: shape.cx + dx, cy: shape.cy + dy };
      }
      break;
    case "bezier": {
      if (pointKey === "p0") {
        const dx = x - shape.p0.x,
          dy = y - shape.p0.y;
        return {
          ...shape,
          p0: { x, y },
          p1: { x: shape.p1.x + dx, y: shape.p1.y + dy },
        };
      }
      if (pointKey === "p3") {
        const dx = x - shape.p3.x,
          dy = y - shape.p3.y;
        return {
          ...shape,
          p3: { x, y },
          p2: { x: shape.p2.x + dx, y: shape.p2.y + dy },
        };
      }
      if (pointKey === "p1") return { ...shape, p1: { x, y } };
      if (pointKey === "p2") return { ...shape, p2: { x, y } };
      break;
    }
    default:
      break;
  }
  return null;
}

export function getSnapPoints(shapes) {
  const pts = [];
  shapes.forEach((shape, shapeIdx) => {
    switch (shape.type) {
      case "line":
        pts.push({ x: shape.x1, y: shape.y1, shapeIdx, pointKey: "start" });
        pts.push({ x: shape.x2, y: shape.y2, shapeIdx, pointKey: "end" });
        break;
      case "rect":
        pts.push({ x: shape.x1, y: shape.y1, shapeIdx, pointKey: "tl" });
        pts.push({ x: shape.x2, y: shape.y1, shapeIdx, pointKey: "tr" });
        pts.push({ x: shape.x2, y: shape.y2, shapeIdx, pointKey: "br" });
        pts.push({ x: shape.x1, y: shape.y2, shapeIdx, pointKey: "bl" });
        break;
      case "circle":
        pts.push({ x: shape.cx, y: shape.cy, shapeIdx, pointKey: "center" });
        break;
      case "ellipse":
        pts.push({ x: shape.cx, y: shape.cy, shapeIdx, pointKey: "center" });
        break;
      case "arc": {
        const { cx, cy, r, startAngle, endAngle } = shape;
        pts.push({
          x: cx + Math.cos(startAngle) * r,
          y: cy + Math.sin(startAngle) * r,
          shapeIdx,
          pointKey: "start",
        });
        pts.push({
          x: cx + Math.cos(endAngle) * r,
          y: cy + Math.sin(endAngle) * r,
          shapeIdx,
          pointKey: "end",
        });
        pts.push({ x: cx, y: cy, shapeIdx, pointKey: "center" });
        break;
      }
      case "bezier":
        pts.push({ x: shape.p0.x, y: shape.p0.y, shapeIdx, pointKey: "p0" });
        pts.push({ x: shape.p3.x, y: shape.p3.y, shapeIdx, pointKey: "p3" });
        break;
      default:
        break;
    }
  });
  return pts;
}

export function getShapePoint(shape, pointKey) {
  switch (shape.type) {
    case "line":
      return pointKey === "start"
        ? { x: shape.x1, y: shape.y1 }
        : { x: shape.x2, y: shape.y2 };
    case "rect":
      if (pointKey === "tl") return { x: shape.x1, y: shape.y1 };
      if (pointKey === "tr") return { x: shape.x2, y: shape.y1 };
      if (pointKey === "br") return { x: shape.x2, y: shape.y2 };
      if (pointKey === "bl") return { x: shape.x1, y: shape.y2 };
      return null;
    case "circle":
      if (pointKey === "edge") return { x: shape.cx + shape.r, y: shape.cy };
      return { x: shape.cx, y: shape.cy };
    case "ellipse":
      return { x: shape.cx, y: shape.cy };
    case "arc":
      if (pointKey === "center") return { x: shape.cx, y: shape.cy };
      if (pointKey === "start")
        return {
          x: shape.cx + Math.cos(shape.startAngle) * shape.r,
          y: shape.cy + Math.sin(shape.startAngle) * shape.r,
        };
      if (pointKey === "end")
        return {
          x: shape.cx + Math.cos(shape.endAngle) * shape.r,
          y: shape.cy + Math.sin(shape.endAngle) * shape.r,
        };
      return null;
    case "bezier":
      return shape[pointKey] ?? null;
    default:
      return null;
  }
}

export function getShapeLength(shape) {
  switch (shape.type) {
    case "line": {
      const dx = shape.x2 - shape.x1,
        dy = shape.y2 - shape.y1;
      return Math.sqrt(dx * dx + dy * dy) * MM_PER_UNIT;
    }
    case "arc":
      return (
        Math.abs(shape.endAngle - shape.startAngle) * shape.r * MM_PER_UNIT
      );
    case "circle":
      return 2 * Math.PI * shape.r * MM_PER_UNIT;
    case "ellipse": {
      const a = shape.rx,
        b = shape.ry;
      const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
      return (
        Math.PI *
        (a + b) *
        (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))) *
        MM_PER_UNIT
      );
    }
    case "bezier": {
      const curve = new THREE.CubicBezierCurve(
        new THREE.Vector2(shape.p0.x, shape.p0.y),
        new THREE.Vector2(shape.p1.x, shape.p1.y),
        new THREE.Vector2(shape.p2.x, shape.p2.y),
        new THREE.Vector2(shape.p3.x, shape.p3.y),
      );
      const pts = curve.getPoints(32);
      let len = 0;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x,
          dy = pts[i].y - pts[i - 1].y;
        len += Math.sqrt(dx * dx + dy * dy);
      }
      return len * MM_PER_UNIT;
    }
    default:
      return null;
  }
}
