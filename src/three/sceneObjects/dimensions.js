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
// of the user's Resolution setting (which is for CSG/bevel
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

// Resolved dimensions (scene units) of a parametric primitive, with the legacy
// defaults applied when an item carries no `dimensions`.  Shared by the hull
// builder, the analytic shaders, the custom raycasts and the OCC builders, so
// they all agree on a primitive's size.
export function primitiveDimensions(item) {
  const d = (item && item.dimensions) || {};
  switch (item && item.type) {
    case "cube":
      return {
        width: d.width ?? 2,
        height: d.height ?? 2,
        depth: d.depth ?? 2,
      };
    case "sphere":
      return { radius: d.radius ?? 1.5 };
    case "cylinder":
      return { radius: d.radius ?? 1, height: d.height ?? 2 };
    case "torus":
      return { major: d.major ?? 1, minor: d.minor ?? 0.4 };
    case "cone":
      return {
        radiusBottom: d.radiusBottom ?? 1,
        radiusTop: d.radiusTop ?? 0,
        height: d.height ?? 2,
      };
    default:
      return {};
  }
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

// World-space rotation/scale pivot for an item: its custom origin (a point in
// the local geometry frame) when set, otherwise the bbox centre.  The transform
// gizmo sits here and rotation/scale hold this point fixed.
export function gizmoCenterFor(item, mesh) {
  const o = item?.origin;
  if (o) {
    mesh.updateMatrixWorld();
    return mesh.localToWorld(new THREE.Vector3(o.x, o.y, o.z));
  }
  return getMeshBBoxCenter(mesh);
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

// Draw a dimension label as plain coloured text with a thin dark outline for
// legibility — no filled/bordered background box.
function drawDimText(ctx, W, H, text, cssColor) {
  ctx.clearRect(0, 0, W, H);
  ctx.font = "bold 30px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(12,12,12,0.85)";
  ctx.strokeText(text, W / 2, H / 2);
  ctx.fillStyle = cssColor;
  ctx.fillText(text, W / 2, H / 2);
}

export function makeDimSprite(text, cssColor) {
  const W = 168,
    H = 52;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  drawDimText(ctx, W, H, text, cssColor);
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
  drawDimText(ctx, canvas.width, canvas.height, text, cssColor);
  mat.map.needsUpdate = true;
}

// Sit each label at the MIDPOINT of the matching-colour bounding-box edge: the
// X label on a bottom-front X edge, Y on a front-right vertical edge, Z on a
// bottom-right edge — so it reads as the length of that edge.
export function placeDimLabels(boundingBox, pos, dim) {
  const { labelX, labelY, labelZ } = boundingBox;
  const hw = dim.w / 2,
    hh = dim.h / 2,
    hd = dim.d / 2;
  // Centre each label on its axis edge, nudged just outward (along the two
  // perpendicular axes) so it sits against the edge instead of over the box.
  const G = 0.35;
  labelX.sprite.position.set(pos.x, pos.y - hh - G, pos.z + hd + G);
  labelY.sprite.position.set(pos.x + hw + G, pos.y, pos.z + hd + G);
  labelZ.sprite.position.set(pos.x + hw + G, pos.y - hh - G, pos.z);
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
