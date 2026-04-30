import * as THREE from "three";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createMaterial } from "./objectMaterials.js";
import { useStore } from "../store";

export const MM_PER_UNIT = 10;

export const HANDLE_CONFIGS = [
  { type: "axisX", color: 0xff4444, dir: new THREE.Vector3(1, 0, 0) },
  { type: "axisY", color: 0x4488ff, dir: new THREE.Vector3(0, 1, 0) },
  { type: "axisZ", color: 0x44ff44, dir: new THREE.Vector3(0, 0, 1) },
  { type: "scale", color: 0xffffff, dir: new THREE.Vector3(1, 1, 1).normalize() },
];

export function getObjectDimensions(itemType, uniformScale) {
  const s = uniformScale || 1;
  switch (itemType) {
    case "cube":     return { w: 2 * s, h: 2 * s, d: 2 * s };
    case "sphere":   return { w: 3 * s, h: 3 * s, d: 3 * s };
    case "cylinder": return { w: 2 * s, h: 2 * s, d: 2 * s };
    case "torus":    return { w: 2.8 * s, h: 0.8 * s, d: 2.8 * s };
    case "sketch":   return { w: 3 * s, h: 3 * s, d: 0.05 };
    default:         return { w: 2 * s, h: 2 * s, d: 2 * s };
  }
}

export function getObjectExtent(itemType, uniformScale) {
  const s = uniformScale || 1;
  switch (itemType) {
    case "sphere":   return 1.5 * s;
    case "torus":    return 1.4 * s;
    case "sketch":   return 1.5 * s;
    default:         return 1.0 * s;
  }
}

export function makeDimSprite(text, cssColor) {
  const W = 168, H = 52;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(12,12,12,0.85)";
  ctx.fillRect(3, 3, W - 6, H - 6);
  ctx.strokeStyle = cssColor; ctx.lineWidth = 2.5;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.fillStyle = cssColor;
  ctx.font = "bold 26px monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.5, 0.46, 1);
  sprite.renderOrder = 1000;
  return { sprite, canvas, ctx, mat };
}

export function redrawDimSprite(dimObj, text, cssColor) {
  const { canvas, ctx, mat } = dimObj;
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(12,12,12,0.85)";
  ctx.fillRect(3, 3, W - 6, H - 6);
  ctx.strokeStyle = cssColor; ctx.lineWidth = 2.5;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.fillStyle = cssColor;
  ctx.font = "bold 26px monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2);
  mat.map.needsUpdate = true;
}

export function placeDimLabels(boundingBox, pos, dim) {
  const { labelX, labelY, labelZ } = boundingBox;
  const GAP = 0.75;
  const hw = dim.w / 2, hh = dim.h / 2, hd = dim.d / 2;
  labelX.sprite.position.set(pos.x, pos.y + hh + GAP, pos.z - hd);
  labelY.sprite.position.set(pos.x + hw + GAP, pos.y, pos.z - hd);
  labelZ.sprite.position.set(pos.x + hw + GAP, pos.y + hh + GAP, pos.z);
}

export function makeMeasureLabel(text, cssColor) {
  const W = 120, H = 38;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = cssColor;
  ctx.font = "bold 22px monospace";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2);
  const mat = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.8, 0.25, 1);
  sprite.renderOrder = 1001;
  return sprite;
}

// ── Sketch 2D shape helpers ──────────────────────────────────────────────────

export function buildSketchShape(tool, start, current) {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const r = Math.sqrt(dx * dx + dy * dy);
  switch (tool) {
    case "rect":    return { type: "rect",    x1: start.x, y1: start.y, x2: current.x, y2: current.y };
    case "circle":  return { type: "circle",  cx: start.x, cy: start.y, r };
    case "ellipse": return { type: "ellipse", cx: start.x, cy: start.y, rx: Math.abs(dx), ry: Math.abs(dy) };
    case "line":    return { type: "line",    x1: start.x, y1: start.y, x2: current.x, y2: current.y };
    case "arc": {
      const startAngle = Math.atan2(dy, dx);
      return { type: "arc", cx: start.x, cy: start.y, r, startAngle, endAngle: startAngle + Math.PI / 2 };
    }
    default: return null;
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
      return [toWorld(x1, y1), toWorld(x2, y1), toWorld(x2, y2), toWorld(x1, y2), toWorld(x1, y1)];
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
        new THREE.Vector2(p0.x, p0.y), new THREE.Vector2(p1.x, p1.y),
        new THREE.Vector2(p2.x, p2.y), new THREE.Vector2(p3.x, p3.y),
      );
      return curve.getPoints(48).map(({ x, y }) => toWorld(x, y));
    }
    default: return [];
  }
}

export function sketchDimText(tool, start, current) {
  const dx = current.x - start.x;
  const dy = current.y - start.y;
  const L = Math.sqrt(dx * dx + dy * dy) * MM_PER_UNIT;
  const W = Math.abs(dx) * MM_PER_UNIT;
  const H = Math.abs(dy) * MM_PER_UNIT;
  switch (tool) {
    case "line":   return `${L.toFixed(1)} mm`;
    case "arc":    return `r ${L.toFixed(1)} mm`;
    case "circle": return `⌀ ${(L * 2).toFixed(1)} mm`;
    default:       return `W ${W.toFixed(1)}  H ${H.toFixed(1)} mm`;
  }
}

export function moveShapePoint(shape, pointKey, newPos) {
  const { x, y } = newPos;
  switch (shape.type) {
    case "line":
      if (pointKey === "start") return { ...shape, x1: x, y1: y };
      if (pointKey === "end")   return { ...shape, x2: x, y2: y };
      break;
    case "rect":
      if (pointKey === "tl") return { ...shape, x1: x, y1: y };
      if (pointKey === "tr") return { ...shape, x2: x, y1: y };
      if (pointKey === "br") return { ...shape, x2: x, y2: y };
      if (pointKey === "bl") return { ...shape, x1: x, y2: y };
      break;
    case "circle":
      if (pointKey === "center") return { ...shape, cx: x, cy: y };
      break;
    case "ellipse":
      if (pointKey === "center") return { ...shape, cx: x, cy: y };
      break;
    case "arc":
      if (pointKey === "center") return { ...shape, cx: x, cy: y };
      if (pointKey === "start") {
        // Translate the arc center so the start endpoint reaches (x, y), preserving radius and angles.
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
        const dx = x - shape.p0.x, dy = y - shape.p0.y;
        return { ...shape, p0: { x, y }, p1: { x: shape.p1.x + dx, y: shape.p1.y + dy } };
      }
      if (pointKey === "p3") {
        const dx = x - shape.p3.x, dy = y - shape.p3.y;
        return { ...shape, p3: { x, y }, p2: { x: shape.p2.x + dx, y: shape.p2.y + dy } };
      }
      if (pointKey === "p1") return { ...shape, p1: { x, y } };
      if (pointKey === "p2") return { ...shape, p2: { x, y } };
      break;
    }
    default: break;
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
        pts.push({ x: cx + Math.cos(startAngle) * r, y: cy + Math.sin(startAngle) * r, shapeIdx, pointKey: "start" });
        pts.push({ x: cx + Math.cos(endAngle) * r,   y: cy + Math.sin(endAngle) * r,   shapeIdx, pointKey: "end" });
        pts.push({ x: cx, y: cy, shapeIdx, pointKey: "center" });
        break;
      }
      case "bezier":
        pts.push({ x: shape.p0.x, y: shape.p0.y, shapeIdx, pointKey: "p0" });
        pts.push({ x: shape.p3.x, y: shape.p3.y, shapeIdx, pointKey: "p3" });
        break;
      default: break;
    }
  });
  return pts;
}

export function getShapePoint(shape, pointKey) {
  switch (shape.type) {
    case "line":
      return pointKey === "start" ? { x: shape.x1, y: shape.y1 } : { x: shape.x2, y: shape.y2 };
    case "rect":
      if (pointKey === "tl") return { x: shape.x1, y: shape.y1 };
      if (pointKey === "tr") return { x: shape.x2, y: shape.y1 };
      if (pointKey === "br") return { x: shape.x2, y: shape.y2 };
      if (pointKey === "bl") return { x: shape.x1, y: shape.y2 };
      return null;
    case "circle":
    case "ellipse":
      return { x: shape.cx, y: shape.cy };
    case "arc":
      if (pointKey === "center") return { x: shape.cx, y: shape.cy };
      if (pointKey === "start") return { x: shape.cx + Math.cos(shape.startAngle) * shape.r, y: shape.cy + Math.sin(shape.startAngle) * shape.r };
      if (pointKey === "end")   return { x: shape.cx + Math.cos(shape.endAngle)   * shape.r, y: shape.cy + Math.sin(shape.endAngle)   * shape.r };
      return null;
    case "bezier":
      return shape[pointKey] ?? null;
    default: return null;
  }
}

export function getShapeLength(shape) {
  switch (shape.type) {
    case "line": {
      const dx = shape.x2 - shape.x1, dy = shape.y2 - shape.y1;
      return Math.sqrt(dx * dx + dy * dy) * MM_PER_UNIT;
    }
    case "arc":
      return Math.abs(shape.endAngle - shape.startAngle) * shape.r * MM_PER_UNIT;
    case "circle":
      return 2 * Math.PI * shape.r * MM_PER_UNIT;
    case "ellipse": {
      const a = shape.rx, b = shape.ry;
      const h = ((a - b) * (a - b)) / ((a + b) * (a + b));
      return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))) * MM_PER_UNIT;
    }
    case "bezier": {
      const curve = new THREE.CubicBezierCurve(
        new THREE.Vector2(shape.p0.x, shape.p0.y), new THREE.Vector2(shape.p1.x, shape.p1.y),
        new THREE.Vector2(shape.p2.x, shape.p2.y), new THREE.Vector2(shape.p3.x, shape.p3.y),
      );
      const pts = curve.getPoints(32);
      let len = 0;
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
        len += Math.sqrt(dx * dx + dy * dy);
      }
      return len * MM_PER_UNIT;
    }
    default: return null;
  }
}

// ── Scene object building ─────────────────────────────────────────────────────

export function buildSceneObjects(items, scene, objectsRef, originalMaterialsRef) {
  Object.values(objectsRef.current).forEach((mesh) => {
    scene.remove(mesh);
    mesh.geometry.dispose();
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
    else mesh.material.dispose();
    mesh.children.forEach((child) => {
      child.geometry && child.geometry.dispose();
      child.material && child.material.dispose();
    });
  });
  objectsRef.current = {};
  originalMaterialsRef.current = {};

  items.forEach((item) => {
    let geometry;
    switch (item.type) {
      case "cube":     geometry = new THREE.BoxGeometry(2, 2, 2); break;
      case "sphere":   geometry = new THREE.BoxGeometry(3, 3, 3); break;
      case "cylinder": geometry = new THREE.BoxGeometry(2, 2, 2); break;
      case "torus":    geometry = new THREE.BoxGeometry(3, 1.2, 3); break;
      case "sketch":   geometry = new THREE.PlaneGeometry(3, 3); break;
      case "csg": {
        if (!item.geometryData) return;
        const { positions, normals, indices } = item.geometryData;
        geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
        if (normals) geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
        if (indices) geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
        if (!normals) geometry.computeVertexNormals();
        break;
      }
      case "extrude": {
        const profile = item.profile;
        if (!profile) return;
        let poly = profile.polygon2D;
        let holePolys = profile.holes || [];
        // Recompute polygon and holes live from the sketch so edits propagate.
        if (profile.sketchId != null) {
          const sketchItem = items.find((si) => si.id === profile.sketchId);
          if (sketchItem && sketchItem.shapes && sketchItem.shapes.length > 0) {
            const allLoops = findClosedLoops(sketchItem.shapes);
            const grouped = groupLoopsWithHoles(allLoops);
            if (grouped.length > 0) {
              // Find the outer loop group whose centroid is closest to the stored centroid.
              const pc = profile.profileCentroid;
              const match = pc
                ? grouped.reduce((best, g) => {
                    const c = polyCentroid(g.polygon);
                    const d = Math.hypot(c.x - pc.x, c.y - pc.y);
                    return d < best.d ? { g, d } : best;
                  }, { g: grouped[0], d: Infinity }).g
                : grouped[0];
              if (match.polygon.length >= 3) { poly = match.polygon; holePolys = match.holes.filter((h) => h.length >= 3); }
            }
          }
        }
        if (!poly || poly.length < 3) return;
        const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
        holePolys.forEach((hole) => shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y)))));
        geometry = new THREE.ExtrudeGeometry(shape, { depth: item.depth ?? 1.0, bevelEnabled: false });
        geometry.computeVertexNormals();
        break;
      }
      default: return;
    }

    const color = 0xe0e0e0;
    const material = createMaterial(item, color);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = item.type !== "sketch";
    mesh.receiveShadow = item.type !== "sketch";
    mesh.userData.itemId = item.id;
    if (["sphere", "cylinder", "torus"].includes(item.type)) {
      mesh.userData.hullGeometry = geometry;
      mesh.userData.shaderMat = material;
    }

    const p = item.position;
    mesh.position.set(p ? p.x : 0, p ? p.y : 2, p ? p.z : 0);
    mesh.scale.setScalar(item.scale ? item.scale.x : 1);
    const rot = item.rotation;
    if (rot) mesh.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);

    if (item.type === "sphere") {
      mesh.raycast = (raycaster, intersects) => {
        const worldCenter = new THREE.Vector3();
        mesh.getWorldPosition(worldCenter);
        const worldScale = new THREE.Vector3();
        mesh.getWorldScale(worldScale);
        const radius = 1.5 * worldScale.x;
        const sphere = new THREE.Sphere(worldCenter, radius);
        const target = new THREE.Vector3();
        if (!raycaster.ray.intersectSphere(sphere, target)) return;
        const dist = raycaster.ray.origin.distanceTo(target);
        if (dist < raycaster.near || dist > raycaster.far) return;
        intersects.push({ distance: dist, point: target.clone(), face: { normal: target.clone().sub(worldCenter).normalize() }, faceIndex: 0, object: mesh });
      };
    } else if (item.type === "cylinder") {
      mesh.raycast = (raycaster, intersects) => {
        const wc = new THREE.Vector3(); mesh.getWorldPosition(wc);
        const ws = new THREE.Vector3(); mesh.getWorldScale(ws);
        const radius = 1.0 * ws.x;
        const halfH  = 1.0 * ws.y;
        const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(mesh.quaternion).normalize();
        const ray = raycaster.ray;
        const oc  = new THREE.Vector3().subVectors(ray.origin, wc);
        const da  = ray.direction.dot(axis);
        const oca = oc.dot(axis);
        const A = 1.0 - da * da;
        const B = 2.0 * (ray.direction.dot(oc) - da * oca);
        const C = oc.dot(oc) - oca * oca - radius * radius;
        let tHit = Infinity, nHit = null;
        if (Math.abs(A) > 1e-6) {
          const disc = B * B - 4 * A * C;
          if (disc >= 0) {
            const sq = Math.sqrt(disc);
            for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
              if (t > raycaster.near && t < tHit) {
                const p = ray.origin.clone().addScaledVector(ray.direction, t);
                const y = p.clone().sub(wc).dot(axis);
                if (Math.abs(y) <= halfH) { tHit = t; nHit = p.clone().sub(wc).addScaledVector(axis, -y).normalize(); }
              }
            }
          }
        }
        if (Math.abs(da) > 1e-6) {
          for (const sign of [1, -1]) {
            const t = (sign * halfH - oca) / da;
            if (t > raycaster.near && t < tHit) {
              const p = ray.origin.clone().addScaledVector(ray.direction, t);
              if (p.clone().sub(wc).addScaledVector(axis, -sign * halfH).lengthSq() <= radius * radius) {
                tHit = t; nHit = axis.clone().multiplyScalar(sign);
              }
            }
          }
        }
        if (tHit === Infinity || tHit > raycaster.far) return;
        intersects.push({ distance: tHit, point: ray.origin.clone().addScaledVector(ray.direction, tHit), face: { normal: nHit || axis }, faceIndex: 0, object: mesh });
      };
    } else if (item.type === "torus") {
      mesh.raycast = (raycaster, intersects) => {
        const wc = new THREE.Vector3(); mesh.getWorldPosition(wc);
        const ws = new THREE.Vector3(); mesh.getWorldScale(ws);
        const outerR = (1.0 + 0.4) * ws.x;
        const sphere = new THREE.Sphere(wc, outerR);
        const target = new THREE.Vector3();
        if (!raycaster.ray.intersectSphere(sphere, target)) return;
        const dist = raycaster.ray.origin.distanceTo(target);
        if (dist < raycaster.near || dist > raycaster.far) return;
        intersects.push({ distance: dist, point: target.clone(), face: { normal: target.clone().sub(wc).normalize() }, faceIndex: 0, object: mesh });
      };
    } else if (item.type !== "sketch") {
      mesh.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0x333333, linewidth: 2 }),
      ));
    }

    mesh.visible = item.visible !== false;
    scene.add(mesh);
    objectsRef.current[item.id] = mesh;
    originalMaterialsRef.current[item.id] = {
      color: new THREE.Color(color),
      metalness: 0.2,
      roughness: 0.2,
      emissive: new THREE.Color(0x000000),
    };
  });
}

// ── Transform handles + bounding box ────────────────────────────────────────

export function buildTransformHandles(selectedId, items, objectsRef) {
  const mesh = objectsRef.current[selectedId];
  if (!mesh) return null;
  const item = items.find((i) => i.id === selectedId);
  if (!item || item.type === "sketch") return null;

  const handles = [];
  const ext = getObjectExtent(item.type, mesh.scale.x);

  HANDLE_CONFIGS.forEach(({ type, color, dir }) => {
    const geo = new THREE.SphereGeometry(0.12, 10, 10);
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false });
    const hMesh = new THREE.Mesh(geo, mat);
    hMesh.renderOrder = 999;
    hMesh.userData.isHandle = true;
    hMesh.position.copy(mesh.position).addScaledVector(dir, ext + 0.5);
    handles.push({ mesh: hMesh, type, dir: dir.clone() });
  });

  const torusRadius = ext + 0.85;
  [
    { type: "rotX", color: 0xff4444, rx: 0,            ry: Math.PI / 2, rz: 0 },
    { type: "rotY", color: 0x4488ff, rx: Math.PI / 2,  ry: 0,           rz: 0 },
    { type: "rotZ", color: 0x44ff44, rx: 0,            ry: 0,           rz: 0 },
  ].forEach(({ type, color, rx, ry, rz }) => {
    const geo = new THREE.TorusGeometry(torusRadius, 0.045, 6, 64);
    const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, side: THREE.DoubleSide });
    const torus = new THREE.Mesh(geo, mat);
    torus.renderOrder = 998;
    torus.userData.isHandle = true;
    torus.position.copy(mesh.position);
    torus.rotation.set(rx, ry, rz);
    handles.push({ mesh: torus, type, dir: null });
  });

  const dim = getObjectDimensions(item.type, mesh.scale.x);
  const boxMesh = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
    new THREE.LineBasicMaterial({ color: 0x88ccff, depthTest: false, transparent: true, opacity: 0.7 }),
  );
  boxMesh.renderOrder = 998;
  boxMesh.scale.set(dim.w, dim.h, dim.d);
  boxMesh.position.copy(mesh.position);

  const mmX = Math.round(dim.w * MM_PER_UNIT);
  const mmY = Math.round(dim.h * MM_PER_UNIT);
  const mmZ = Math.round(dim.d * MM_PER_UNIT);
  const labelX = makeDimSprite(mmX + "mm", "#ff4444");
  const labelY = makeDimSprite(mmY + "mm", "#4488ff");
  const labelZ = makeDimSprite(mmZ + "mm", "#44ff44");

  const boundingBox = { boxMesh, labelX, labelY, labelZ };
  placeDimLabels(boundingBox, mesh.position, dim);

  return { handles, boundingBox };
}

// ── Closed-loop detection for fill regions ────────────────────────────────────

function sampleShapeForPoly(shape, startIsA, N = 16) {
  switch (shape.type) {
    case "line":
      return startIsA ? [{ x: shape.x1, y: shape.y1 }] : [{ x: shape.x2, y: shape.y2 }];
    case "arc": {
      const { cx, cy, r, startAngle, endAngle } = shape;
      const from = startIsA ? startAngle : endAngle;
      const to   = startIsA ? endAngle   : startAngle;
      return Array.from({ length: N }, (_, i) => {
        const a = from + (i / N) * (to - from);
        return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
      });
    }
    case "bezier": {
      const [q0, q1, q2, q3] = startIsA
        ? [shape.p0, shape.p1, shape.p2, shape.p3]
        : [shape.p3, shape.p2, shape.p1, shape.p0];
      return Array.from({ length: N }, (_, i) => {
        const t = i / N, mt = 1 - t;
        return {
          x: mt*mt*mt*q0.x + 3*mt*mt*t*q1.x + 3*mt*t*t*q2.x + t*t*t*q3.x,
          y: mt*mt*mt*q0.y + 3*mt*mt*t*q1.y + 3*mt*t*t*q2.y + t*t*t*q3.y,
        };
      });
    }
    default: return [];
  }
}

// Returns [{ polygon, shapeIndices }] — shapeIndices are original indices into `shapes`.
// Both closed line-graphs AND self-closing shapes (circle/ellipse/rect) are included.
export function findClosedLoopsWithShapes(shapes) {
  const EPS = 1e-4;
  // Map solid shapes to their original indices
  const solidEntries = [];
  shapes.forEach((s, i) => { if (!s.dashed && s.kind !== "bevel") solidEntries.push({ shape: s, origIdx: i }); });
  const solidShapes = solidEntries.map(e => e.shape);

  const nodes = [];
  const getNode = (x, y) => {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i].x - x, nodes[i].y - y) < EPS) return i;
    }
    nodes.push({ x, y });
    return nodes.length - 1;
  };

  const shapeNodes = solidShapes.map((shape) => {
    if (shape.type === "line")
      return { a: getNode(shape.x1, shape.y1), b: getNode(shape.x2, shape.y2) };
    if (shape.type === "arc")
      return {
        a: getNode(shape.cx + Math.cos(shape.startAngle) * shape.r, shape.cy + Math.sin(shape.startAngle) * shape.r),
        b: getNode(shape.cx + Math.cos(shape.endAngle)   * shape.r, shape.cy + Math.sin(shape.endAngle)   * shape.r),
      };
    if (shape.type === "bezier")
      return { a: getNode(shape.p0.x, shape.p0.y), b: getNode(shape.p3.x, shape.p3.y) };
    return null;
  });

  const adj = {};
  shapeNodes.forEach((sn, si) => {
    if (!sn || sn.a === sn.b) return;
    (adj[sn.a] = adj[sn.a] || []).push({ si, otherNode: sn.b });
    (adj[sn.b] = adj[sn.b] || []).push({ si, otherNode: sn.a });
  });

  const cycleKeys = new Set();
  const cycles = [];
  const dfs = (start, cur, path, visited) => {
    if (path.length > 20) return;
    for (const { si, otherNode } of (adj[cur] || [])) {
      if (path.some((e) => e.si === si)) continue;
      if (otherNode === start && path.length >= 2) {
        const key = [...path.map((e) => e.si), si].sort().join(",");
        if (!cycleKeys.has(key)) { cycleKeys.add(key); cycles.push([...path, { si, fromNode: cur, toNode: otherNode }]); }
        continue;
      }
      if (visited.has(otherNode)) continue;
      dfs(start, otherNode, [...path, { si, fromNode: cur, toNode: otherNode }], new Set([...visited, otherNode]));
    }
  };
  Object.keys(adj).forEach((n) => {
    const ni = parseInt(n);
    if ((adj[ni] || []).length >= 2) dfs(ni, ni, [], new Set([ni]));
  });

  const results = cycles.map((path) => {
    const poly = [];
    const idxSet = new Set();
    for (const edge of path) {
      const sn = shapeNodes[edge.si];
      poly.push(...sampleShapeForPoly(solidShapes[edge.si], sn.a === edge.fromNode));
      idxSet.add(solidEntries[edge.si].origIdx);
    }
    return { polygon: poly, shapeIndices: [...idxSet] };
  });

  // Self-closing shapes are always enclosed
  solidEntries.forEach(({ shape, origIdx }) => {
    if (shape.type === "circle") {
      results.push({
        polygon: Array.from({ length: 32 }, (_, i) => {
          const a = (i / 32) * Math.PI * 2;
          return { x: shape.cx + Math.cos(a) * shape.r, y: shape.cy + Math.sin(a) * shape.r };
        }),
        shapeIndices: [origIdx],
      });
    } else if (shape.type === "ellipse") {
      results.push({
        polygon: Array.from({ length: 32 }, (_, i) => {
          const a = (i / 32) * Math.PI * 2;
          return { x: shape.cx + Math.cos(a) * shape.rx, y: shape.cy + Math.sin(a) * shape.ry };
        }),
        shapeIndices: [origIdx],
      });
    } else if (shape.type === "rect") {
      results.push({
        polygon: [
          { x: shape.x1, y: shape.y1 }, { x: shape.x2, y: shape.y1 },
          { x: shape.x2, y: shape.y2 }, { x: shape.x1, y: shape.y2 },
        ],
        shapeIndices: [origIdx],
      });
    }
  });

  return results;
}

export function findClosedLoops(shapes) {
  return findClosedLoopsWithShapes(shapes).map((l) => l.polygon);
}

// ── Object-view sketch lines (all sketches, lines only) ──────────────────────

export function buildAllSketchShapesGroup(items, objectsRef, renderer) {
  const sketchItems = items.filter((item) => item.type === "sketch" && item.shapes?.length > 0 && item.visible !== false);
  if (sketchItems.length === 0) return null;

  const group = new THREE.Group();
  const res = renderer
    ? renderer.getSize(new THREE.Vector2())
    : new THREE.Vector2(window.innerWidth, window.innerHeight);

  sketchItems.forEach((item) => {
    const sketchMesh = objectsRef.current[item.id];
    if (!sketchMesh) return;
    item.shapes.forEach((shape) => {
      if (shape.kind === "bevel") return; // bevel arcs not shown in object view
      const pts = getSketchShapePoints(shape, sketchMesh);
      if (pts.length < 2) return;
      const geo = new LineGeometry();
      geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
      const mat = new LineMaterial({ color: shape.dashed ? 0x6688cc : 0x88aaff, linewidth: 1.5, depthTest: false, resolution: res, dashed: !!shape.dashed, dashSize: shape.dashed ? 0.1 : 0, gapSize: shape.dashed ? 0.06 : 0 });
      const line = new Line2(geo, mat);
      line.computeLineDistances();
      line.renderOrder = 1001;
      group.add(line);
    });
  });

  return group.children.length > 0 ? group : null;
}

// ── Loop nesting helpers ──────────────────────────────────────────────────────

function polyContainsPoint(poly, pt) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > pt.y) !== (yj > pt.y) && pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi)
      inside = !inside;
  }
  return inside;
}

function polyCentroid(poly) {
  return {
    x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
    y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
  };
}

// Returns [{ polygon, holes: [...] }, ...] grouping loops by containment.
// Outer loops are those whose centroid is not inside any other loop.
// Each outer loop's holes are the immediate children (loops whose centroid is inside it).
function groupLoopsWithHoles(loops) {
  const centroids = loops.map(polyCentroid);
  const isInsideAny = (idx) => loops.some((other, j) => j !== idx && polyContainsPoint(other, centroids[idx]));
  return loops
    .map((loop, i) => (isInsideAny(i) ? null : {
      polygon: loop,
      holes: loops.filter((inner, j) => j !== i && polyContainsPoint(loop, centroids[j])),
    }))
    .filter(Boolean);
}

// ── Extrude profile selection fills (one fill mesh per closed sketch loop) ───

export function buildExtrudeSelectGroup(items, objectsRef) {
  const sketchItems = items.filter((i) => i.type === "sketch" && i.shapes?.length > 0 && i.visible !== false);
  if (sketchItems.length === 0) return null;
  const group = new THREE.Group();
  sketchItems.forEach((item) => {
    const sketchMesh = objectsRef.current[item.id];
    if (!sketchMesh) return;
    const allLoops = findClosedLoops(item.shapes || []);
    const grouped = groupLoopsWithHoles(allLoops);
    const euler = new THREE.Euler().setFromQuaternion(sketchMesh.quaternion);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(sketchMesh.quaternion);
    grouped.forEach(({ polygon, holes }) => {
      if (polygon.length < 3) return;
      const shape = new THREE.Shape(polygon.map((p) => new THREE.Vector2(p.x, p.y)));
      holes.forEach((hole) => {
        if (hole.length >= 3)
          shape.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y))));
      });
      const geo = new THREE.ShapeGeometry(shape);
      const mat = new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthTest: false });
      const fill = new THREE.Mesh(geo, mat);
      fill.position.copy(sketchMesh.position).addScaledVector(normal, 0.005);
      fill.quaternion.copy(sketchMesh.quaternion);
      fill.renderOrder = 995;
      fill.userData.extrudeProfile = {
        type: "sketchLoop",
        sketchId: item.id,
        profileCentroid: polyCentroid(polygon),
        polygon2D: polygon,
        holes: holes.filter((h) => h.length >= 3),
        position: { x: sketchMesh.position.x, y: sketchMesh.position.y, z: sketchMesh.position.z },
        rotation: { x: euler.x, y: euler.y, z: euler.z },
        normalWorld: { x: normal.x, y: normal.y, z: normal.z },
      };
      group.add(fill);
    });
  });
  return group.children.length > 0 ? group : null;
}

// ── Sketch shapes line group ─────────────────────────────────────────────────

export function buildSketchShapesGroup(selectedId, items, objectsRef, renderer, showConstraints = true) {
  const selItem = items.find((i) => i.id === selectedId);
  if (selItem?.type !== "sketch") return null;
  const sketchMesh = objectsRef.current[selectedId];
  if (!sketchMesh) return null;
  const shapes = selItem.shapes || [];
  if (shapes.length === 0) return null;

  const group = new THREE.Group();
  const res = renderer ? renderer.getSize(new THREE.Vector2()) : new THREE.Vector2(window.innerWidth, window.innerHeight);

  const toWorld = (lx, ly, z = 0.003) => {
    const v = new THREE.Vector3(lx, ly, z);
    v.applyQuaternion(sketchMesh.quaternion);
    v.add(sketchMesh.position);
    return v;
  };

  // ── Shape lines (Line2 for actual pixel-width thickness) ──────────────────
  const dotWorldPts = [];
  shapes.forEach((shape, shapeIdx) => {
    const pts = getSketchShapePoints(shape, sketchMesh);
    if (pts.length < 2) return;

    const isBevel = shape.kind === "bevel";
    const isDashed = !!shape.dashed;
    const geo = new LineGeometry();
    geo.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    const mat = new LineMaterial({
      color: isBevel ? 0xffaa44 : 0x88aaff,
      linewidth: isBevel ? 1.0 : 1.5,
      depthTest: false,
      resolution: res,
      transparent: isBevel || isDashed,
      opacity: isBevel ? 0.55 : (isDashed ? 0.75 : 1.0),
      dashed: isDashed || isBevel,
      dashSize: (isDashed || isBevel) ? 0.1 : 0,
      gapSize: (isDashed || isBevel) ? 0.06 : 0,
    });
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 1001;
    line.userData.shapeIdx = shapeIdx;
    group.add(line);

    // Collect key points for dots
    getSnapPoints([shape]).forEach((sp) => dotWorldPts.push(toWorld(sp.x, sp.y, 0.004)));
  });

  // ── Point dots ────────────────────────────────────────────────────────────
  if (dotWorldPts.length > 0) {
    const ptGeo = new THREE.BufferGeometry().setFromPoints(dotWorldPts);
    const ptMat = new THREE.PointsMaterial({ color: 0xaabbff, size: 5, sizeAttenuation: false, depthTest: false });
    const dots = new THREE.Points(ptGeo, ptMat);
    dots.renderOrder = 1003;
    group.add(dots);
  }

  // ── Constraint icons ──────────────────────────────────────────────────────
  const constraints = selItem.constraints || [];
  if (showConstraints) constraints.forEach((c, ci) => {
    const R = 0.14;
    // Helper: tag the first visual object of a constraint so cameraControls can
    // screen-space hit-test it and highlight connected lines on hover.
    const tagConstraint = (obj, iconLocalPos, shapeIndices, color) => {
      obj.userData.isConstraint = true;
      obj.userData.constraintIdx = ci;
      obj.userData.constraintType = c.type;
      obj.userData.constraintIconLocalPos = iconLocalPos;
      obj.userData.constraintShapeIndices = shapeIndices;
      obj.userData.constraintColor = color;
    };

    if (c.type === "coincident") {
      const shapeA = shapes[c.shapeAIdx];
      if (!shapeA) return;
      const pt = getShapePoint(shapeA, c.pointA);
      if (!pt) return;
      const dPts = [
        toWorld(pt.x,     pt.y + R, 0.005),
        toWorld(pt.x + R, pt.y,     0.005),
        toWorld(pt.x,     pt.y - R, 0.005),
        toWorld(pt.x - R, pt.y,     0.005),
        toWorld(pt.x,     pt.y + R, 0.005),
      ];
      const cLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(dPts),
        new THREE.LineBasicMaterial({ color: 0xffaa00, depthTest: false }),
      );
      cLine.renderOrder = 1004;
      tagConstraint(cLine, { x: pt.x, y: pt.y }, [c.shapeAIdx, c.shapeBIdx], 0xffaa00);
      group.add(cLine);
    } else if (c.type === "distance") {
      const sA = shapes[c.shapeAIdx], sB = shapes[c.shapeBIdx];
      if (!sA || !sB) return;
      const posA = getShapePoint(sA, c.pointA), posB = getShapePoint(sB, c.pointB);
      if (!posA || !posB) return;
      const wA = toWorld(posA.x, posA.y, 0.006), wB = toWorld(posB.x, posB.y, 0.006);
      const dimLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([wA, wB]),
        new THREE.LineBasicMaterial({ color: 0xffdd44, depthTest: false }),
      );
      dimLine.renderOrder = 1004;
      const midLocal = { x: (posA.x + posB.x) / 2, y: (posA.y + posB.y) / 2 };
      const distShapes = c.shapeAIdx === c.shapeBIdx ? [c.shapeAIdx] : [c.shapeAIdx, c.shapeBIdx];
      tagConstraint(dimLine, midLocal, distShapes, 0xffdd44);
      group.add(dimLine);
      // Tick marks at each end
      const dir = new THREE.Vector3().subVectors(wB, wA).normalize();
      const perp = new THREE.Vector3(-dir.y, dir.x, 0).normalize().multiplyScalar(0.1);
      for (const pt of [wA, wB]) {
        const t = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([pt.clone().sub(perp), pt.clone().add(perp)]),
          new THREE.LineBasicMaterial({ color: 0xffdd44, depthTest: false }),
        );
        t.renderOrder = 1004;
        group.add(t);
      }
      // Label sprite at midpoint
      const mid = new THREE.Vector3().addVectors(wA, wB).multiplyScalar(0.5);
      const labelText = (c.distance * MM_PER_UNIT).toFixed(1) + "mm";
      const canvas = document.createElement("canvas");
      canvas.width = 128; canvas.height = 32;
      const ctx2d = canvas.getContext("2d");
      ctx2d.fillStyle = "rgba(40,30,0,0.85)";
      ctx2d.fillRect(0, 0, canvas.width, canvas.height);
      ctx2d.fillStyle = "#ffee88";
      ctx2d.font = "bold 18px sans-serif";
      ctx2d.textAlign = "center";
      ctx2d.textBaseline = "middle";
      ctx2d.fillText(labelText, canvas.width / 2, canvas.height / 2);
      const tex = new THREE.CanvasTexture(canvas);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
      sprite.scale.set(0.7, 0.175, 1);
      sprite.position.copy(mid.clone().addScaledVector(perp, 3));
      sprite.renderOrder = 1009;
      group.add(sprite);
    } else if (c.type === "onLine") {
      const lineShape = shapes[c.lineShapeIdx];
      const ptShape   = shapes[c.pointShapeIdx];
      if (!lineShape || lineShape.type !== "line" || !ptShape) return;
      const pt = getShapePoint(ptShape, c.pointKey);
      if (!pt) return;
      const dx = lineShape.x2 - lineShape.x1, dy = lineShape.y2 - lineShape.y1;
      const len = Math.hypot(dx, dy);
      if (len < 1e-10) return;
      const nx = -dy / len * R, ny = dx / len * R;
      const tLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          toWorld(pt.x + nx, pt.y + ny, 0.005),
          toWorld(pt.x - nx, pt.y - ny, 0.005),
        ]),
        new THREE.LineBasicMaterial({ color: 0x00aaff, depthTest: false }),
      );
      tLine.renderOrder = 1004;
      tagConstraint(tLine, { x: pt.x, y: pt.y }, [c.pointShapeIdx, c.lineShapeIdx], 0x00aaff);
      group.add(tLine);
    } else if (c.type === "horizontal" || c.type === "vertical") {
      const shape = shapes[c.shapeIdx];
      if (!shape || shape.type !== "line") return;
      const mx = (shape.x1 + shape.x2) / 2;
      const my = (shape.y1 + shape.y2) / 2;
      const dPts = [
        toWorld(mx,     my + R, 0.005),
        toWorld(mx + R, my,     0.005),
        toWorld(mx,     my - R, 0.005),
        toWorld(mx - R, my,     0.005),
        toWorld(mx,     my + R, 0.005),
      ];
      const cLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(dPts),
        new THREE.LineBasicMaterial({ color: 0x00ddaa, depthTest: false }),
      );
      cLine.renderOrder = 1004;
      tagConstraint(cLine, { x: mx, y: my }, [c.shapeIdx], 0x00ddaa);
      group.add(cLine);
    }
  });

  // ── Enclosed region fills (hole-aware, hidden until hover) ──────────────────
  const loopsWithShapes = findClosedLoopsWithShapes(shapes);
  if (loopsWithShapes.length > 0) {
    const polygons = loopsWithShapes.map((l) => l.polygon);
    const polyShapeMap = new Map(loopsWithShapes.map((l) => [l.polygon, l.shapeIndices]));
    const grouped = groupLoopsWithHoles(polygons);
    grouped.forEach(({ polygon: outerPoly, holes }) => {
      if (outerPoly.length < 3) return;
      const outerIndices = polyShapeMap.get(outerPoly) || [];
      const holeIndices = holes.flatMap((h) => polyShapeMap.get(h) || []);
      const allShapeIndices = [...new Set([...outerIndices, ...holeIndices])];
      const shape2D = new THREE.Shape(outerPoly.map((p) => new THREE.Vector2(p.x, p.y)));
      holes.forEach((hole) => {
        if (hole.length >= 3) shape2D.holes.push(new THREE.Path(hole.map((p) => new THREE.Vector2(p.x, p.y))));
      });
      const fillGeo = new THREE.ShapeGeometry(shape2D);
      const fillMat = new THREE.MeshBasicMaterial({
        color: 0x4488ff, transparent: true, opacity: 0.18,
        side: THREE.DoubleSide, depthTest: false,
      });
      const fillMesh = new THREE.Mesh(fillGeo, fillMat);
      fillMesh.position.copy(sketchMesh.position);
      fillMesh.quaternion.copy(sketchMesh.quaternion);
      fillMesh.renderOrder = 999;
      fillMesh.visible = false;
      fillMesh.userData.isRegionFill = true;
      fillMesh.userData.polygon2D = outerPoly;
      fillMesh.userData.holes2D = holes;
      fillMesh.userData.shapeIndices = allShapeIndices;
      group.add(fillMesh);

      // Each hole is also a selectable region on its own (e.g. the circle inside a
      // rectangle is clickable and highlights its own boundary shapes).
      holes.forEach((hole) => {
        if (hole.length < 3) return;
        const innerIndices = polyShapeMap.get(hole) || [];
        if (innerIndices.length === 0) return;
        const innerShape2D = new THREE.Shape(hole.map((p) => new THREE.Vector2(p.x, p.y)));
        const innerGeo = new THREE.ShapeGeometry(innerShape2D);
        const innerMat = new THREE.MeshBasicMaterial({
          color: 0x4488ff, transparent: true, opacity: 0.18,
          side: THREE.DoubleSide, depthTest: false,
        });
        const innerFill = new THREE.Mesh(innerGeo, innerMat);
        innerFill.position.copy(sketchMesh.position);
        innerFill.quaternion.copy(sketchMesh.quaternion);
        innerFill.renderOrder = 1000; // above the ring fill so it gets priority in click checks
        innerFill.visible = false;
        innerFill.userData.isRegionFill = true;
        innerFill.userData.polygon2D = hole;
        innerFill.userData.holes2D = [];
        innerFill.userData.shapeIndices = innerIndices;
        group.add(innerFill);
      });
    });
  }

  return group;
}

// ── Render mode switching ────────────────────────────────────────────────────

export function applyRenderMode(renderMode, ctx) {
  const {
    scene, renderer, cameraRef, objectsRef, originalMaterialsRef, itemsRef,
    axisGroupRef, planeRef, sketchPlacementPlanesRef, composerRef, envTextureRef,
    sketchModeRef,
  } = ctx;

  if (renderMode === "smooth") {
    if (!envTextureRef.current) {
      const pmremGen = new THREE.PMREMGenerator(renderer);
      pmremGen.compileEquirectangularShader();
      const roomEnv = new RoomEnvironment();
      envTextureRef.current = pmremGen.fromScene(roomEnv).texture;
      pmremGen.dispose();
      roomEnv.dispose();
    }
    scene.environment = envTextureRef.current;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;

    const bgCanvas = document.createElement("canvas");
    bgCanvas.width = 2; bgCanvas.height = 512;
    const bgCtx = bgCanvas.getContext("2d");
    const grad = bgCtx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, "#0a0a2e");
    grad.addColorStop(1, "#1a0828");
    bgCtx.fillStyle = grad;
    bgCtx.fillRect(0, 0, 2, 512);
    const bgTex = new THREE.CanvasTexture(bgCanvas);
    bgTex.needsUpdate = true;
    scene.background = bgTex;

    if (axisGroupRef.current) axisGroupRef.current.visible = false;
    if (planeRef.current) planeRef.current.visible = false;
    sketchPlacementPlanesRef.current.forEach(({ mesh }) => { mesh.visible = false; });

    if (!composerRef.current && cameraRef.current) {
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, cameraRef.current));
      composer.addPass(new UnrealBloomPass(
        new THREE.Vector2(renderer.domElement.clientWidth, renderer.domElement.clientHeight),
        0.25, 0.5, 0.85,
      ));
      composer.addPass(new OutputPass());
      composerRef.current = composer;
    }

    Object.values(objectsRef.current).forEach((mesh) => {
      const itemData = itemsRef.current.find((i) => i.id === mesh.userData.itemId);
      if (itemData?.visible === false) { mesh.visible = false; return; }
      if (itemData?.type === "sketch") { mesh.visible = false; return; }
      if (["sphere", "cylinder", "torus"].includes(itemData?.type)) {
        if (mesh.userData.hullGeometry && mesh.geometry !== mesh.userData.hullGeometry) {
          mesh.geometry.dispose(); mesh.geometry = mesh.userData.hullGeometry;
        }
        if (mesh.userData.shaderMat && mesh.material !== mesh.userData.shaderMat) {
          mesh.material.dispose(); mesh.material = mesh.userData.shaderMat;
        }
        return;
      }
      const orig = originalMaterialsRef.current[mesh.userData.itemId];
      const col = orig ? orig.color.clone() : new THREE.Color(0xe0e0e0);
      if (mesh.material) mesh.material.dispose();
      mesh.material = new THREE.MeshPhysicalMaterial({
        color: col, metalness: 0.15, roughness: 0.3,
        clearcoat: 1.0, clearcoatRoughness: 0.1, envMapIntensity: 1.2,
      });
      mesh.children.forEach((child) => { child.visible = false; });
    });
  } else {
    scene.environment = null;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.0;
    if (composerRef.current) {
      composerRef.current.dispose();
      composerRef.current = null;
    }

    const bgColor = useStore.getState().theme === "light" ? 0xe8e8e8 : 0x1a1a1a;
    scene.background = new THREE.Color(bgColor);

    if (axisGroupRef.current) axisGroupRef.current.visible = useStore.getState().axisVisible && !sketchModeRef.current;
    if (planeRef.current && !sketchModeRef.current) planeRef.current.visible = true;
    sketchPlacementPlanesRef.current.forEach(({ mesh }) => { mesh.visible = true; });

    Object.values(objectsRef.current).forEach((mesh) => {
      const itemData = itemsRef.current.find((i) => i.id === mesh.userData.itemId);
      if (itemData?.visible === false) { mesh.visible = false; return; }
      if (itemData?.type === "sketch") { mesh.visible = !sketchModeRef.current; return; }
      if (["sphere", "cylinder", "torus"].includes(itemData?.type)) {
        if (renderMode === "wireframe") {
          let wfGeo;
          if (itemData.type === "sphere") wfGeo = new THREE.SphereGeometry(1.5, 16, 12);
          else if (itemData.type === "cylinder") wfGeo = new THREE.CylinderGeometry(1, 1, 2, 16);
          else wfGeo = new THREE.TorusGeometry(1.0, 0.4, 12, 24);
          if (mesh.geometry !== mesh.userData.hullGeometry) mesh.geometry.dispose();
          mesh.geometry = wfGeo;
          if (mesh.material !== mesh.userData.shaderMat) mesh.material.dispose();
          mesh.material = new THREE.MeshBasicMaterial({ color: 0xaaaaaa, wireframe: true });
        } else {
          if (mesh.userData.hullGeometry && mesh.geometry !== mesh.userData.hullGeometry) {
            mesh.geometry.dispose(); mesh.geometry = mesh.userData.hullGeometry;
          }
          if (mesh.userData.shaderMat && mesh.material !== mesh.userData.shaderMat) {
            mesh.material.dispose(); mesh.material = mesh.userData.shaderMat;
          }
        }
        return;
      }
      const orig = originalMaterialsRef.current[mesh.userData.itemId];
      const col = orig ? orig.color.clone() : new THREE.Color(0xe0e0e0);
      if (mesh.material) mesh.material.dispose();
      mesh.material = new THREE.MeshStandardMaterial({ color: col, metalness: 0.3, roughness: 0.5 });
      mesh.material.wireframe = renderMode === "wireframe";
      mesh.children.forEach((child) => { child.visible = true; });
    });
  }
}
