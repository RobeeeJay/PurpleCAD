// Top-level value constants and small visual helpers that have no
// dependency on the rest of the scene-building code.  Lives at the
// bottom of the dependency graph so every other sceneObjects/* file
// can pull from here without creating cycles.

import * as THREE from "three";
import {
  AXIS_X_COLOR,
  AXIS_Y_COLOR,
  AXIS_Z_COLOR,
  LIGHT_COLOR,
} from "../theme.js";

export const MM_PER_UNIT = 10;

// Snap a scene-unit coordinate to the nearest multiple of `intervalMm`
// (converted to scene units).  Used by the snap-to-grid drag option.
export function snapUnitToIntervalMm(value, intervalMm) {
  if (!(intervalMm > 0)) return value;
  const step = intervalMm / MM_PER_UNIT;
  return Math.round(value / step) * step;
}

// Display-quality precision for wireframe & selection overlays.  The
// smooth shader render is analytic (perfectly smooth), so wireframe /
// hover / selection should ALWAYS look smooth to match — independently
// of the user's curveResolution choice (which is for CSG/bevel
// "operation" quality, not display).  Picked so 0.01 mm sagitta gives
// ~86 segments at r=1.5, indistinguishable from smooth at normal
// viewing distance.
export const DISPLAY_PRECISION_MM = 0.01;

export const HANDLE_CONFIGS = [
  { type: "axisX", color: AXIS_X_COLOR, dir: new THREE.Vector3(1, 0, 0) },
  { type: "axisY", color: AXIS_Y_COLOR, dir: new THREE.Vector3(0, 1, 0) },
  { type: "axisZ", color: AXIS_Z_COLOR, dir: new THREE.Vector3(0, 0, 1) },
  {
    type: "scale",
    color: LIGHT_COLOR,
    dir: new THREE.Vector3(1, 1, 1).normalize(),
  },
];

// Number of polygon segments for a full circle of radius `r` at the
// given chord-deviation precision (mm).  precision=null → return
// defaultSegs (preview mode); otherwise use the sagitta formula so the
// chord deviation from the true circle is ≤ precision mm.  Clamped to
// [8, 256].
export function fullCircleSegments(r, precision, defaultSegs = 32) {
  if (precision == null || r <= 0) return defaultSegs;
  const sUnits = precision / MM_PER_UNIT;
  const halfTheta = Math.acos(Math.max(-1, Math.min(1, 1 - sUnits / r)));
  if (!isFinite(halfTheta) || halfTheta <= 0) return defaultSegs;
  return Math.max(8, Math.min(256, Math.ceil(Math.PI / halfTheta)));
}

export function getObjectDimensions(itemType, uniformScale) {
  const s = uniformScale || 1;
  switch (itemType) {
    case "cube":
      return { w: 2 * s, h: 2 * s, d: 2 * s };
    case "sphere":
      return { w: 3 * s, h: 3 * s, d: 3 * s };
    case "cylinder":
      return { w: 2 * s, h: 2 * s, d: 2 * s };
    case "torus":
      return { w: 2.8 * s, h: 0.8 * s, d: 2.8 * s };
    case "sketch":
      return { w: 3 * s, h: 3 * s, d: 0.05 };
    default:
      return { w: 2 * s, h: 2 * s, d: 2 * s };
  }
}

// Real dimensions (scene units) of a mesh from its geometry's bounding box,
// scaled by the mesh's per-axis scale.  Use this instead of getObjectDimensions
// for anything user-facing: the nominal per-type sizes are only correct for an
// unscaled primitive and read a constant 20 mm for every extrude / CSG / chamfer.
export function getMeshDimensions(mesh) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  return {
    w: (bb.max.x - bb.min.x) * Math.abs(mesh.scale.x || 1),
    h: (bb.max.y - bb.min.y) * Math.abs(mesh.scale.y || 1),
    d: (bb.max.z - bb.min.z) * Math.abs(mesh.scale.z || 1),
  };
}

// World-space centre of a mesh's geometry bounding box (its local bbox centre
// scaled + rotated + offset by the mesh position).  The bounding-box gizmo and
// dimension labels sit here so they enclose geometry that isn't centred on the
// mesh origin (e.g. extrudes).
export function getMeshBBoxCenter(mesh) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  const c = new THREE.Vector3(
    ((bb.min.x + bb.max.x) / 2) * mesh.scale.x,
    ((bb.min.y + bb.max.y) / 2) * mesh.scale.y,
    ((bb.min.z + bb.max.z) / 2) * mesh.scale.z,
  );
  c.applyEuler(mesh.rotation);
  return c.add(mesh.position);
}

// Half the mesh's largest real dimension — used to place the gizmo handles just
// outside the object.
export function getMeshExtent(mesh) {
  const { w, h, d } = getMeshDimensions(mesh);
  return Math.max(w, h, d) / 2;
}

export function getObjectExtent(itemType, uniformScale) {
  const s = uniformScale || 1;
  switch (itemType) {
    case "sphere":
      return 1.5 * s;
    case "torus":
      return 1.4 * s;
    case "sketch":
      return 1.5 * s;
    default:
      return 1.0 * s;
  }
}

export function makeDimSprite(text, cssColor) {
  const W = 168,
    H = 52;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(12,12,12,0.85)";
  ctx.fillRect(3, 3, W - 6, H - 6);
  ctx.strokeStyle = cssColor;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.fillStyle = cssColor;
  ctx.font = "bold 26px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({
    map: tex,
    depthTest: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.5, 0.46, 1);
  sprite.renderOrder = 1000;
  return { sprite, canvas, ctx, mat };
}

export function redrawDimSprite(dimObj, text, cssColor) {
  const { canvas, ctx, mat } = dimObj;
  const W = canvas.width,
    H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "rgba(12,12,12,0.85)";
  ctx.fillRect(3, 3, W - 6, H - 6);
  ctx.strokeStyle = cssColor;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(3, 3, W - 6, H - 6);
  ctx.fillStyle = cssColor;
  ctx.font = "bold 26px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2);
  mat.map.needsUpdate = true;
}

export function placeDimLabels(boundingBox, pos, dim) {
  const { labelX, labelY, labelZ } = boundingBox;
  const GAP = 0.75;
  const hw = dim.w / 2,
    hh = dim.h / 2,
    hd = dim.d / 2;
  labelX.sprite.position.set(pos.x, pos.y + hh + GAP, pos.z - hd);
  labelY.sprite.position.set(pos.x + hw + GAP, pos.y, pos.z - hd);
  labelZ.sprite.position.set(pos.x + hw + GAP, pos.y + hh + GAP, pos.z);
}

export function makeMeasureLabel(text, cssColor) {
  const W = 120,
    H = 38;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = cssColor;
  ctx.font = "bold 22px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, W / 2, H / 2);
  const mat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(canvas),
    depthTest: false,
    transparent: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.8, 0.25, 1);
  sprite.renderOrder = 1001;
  return sprite;
}
