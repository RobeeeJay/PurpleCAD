// Sketch constraint markers drawn with the toolbar's own artwork, sitting a
// fixed number of screen pixels beside the point or line they constrain.
//
// Each marker is a sprite (always faces the viewer) whose `center` is moved
// off the quad, so its anchor -- the constrained point, or a line's middle --
// stays exactly on the geometry while the picture sits beside it.  The render
// loop sizes it every frame to CONSTRAINT_ICON_SIZE_PX on screen
// (cameraControls/animateLoop.js), and because `center` is measured in
// sprite-size units, the offset stays a constant number of pixels too.
//
// The artwork is the same React component the toolbar button renders
// (components/icons/constraintIconArt.jsx), drawn once per look onto a canvas
// over a small backing plate so it reads against any sketch.

import * as THREE from "three";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CONSTRAINT_ICON_ART } from "../../components/icons/constraintIconArt.jsx";
import { requestRender } from "../renderRequest.js";
import { sketchSelectedColorFor, toCssHex } from "../theme.js";

// How far a marker sits from the point or line it belongs to, in screen pixels.
export const CONSTRAINT_ICON_OFFSET_PX = 10;
// A marker's size on screen, in pixels.  The artwork fills about three
// quarters of it, so 22 draws it close to its 20 px size on the toolbar.
export const CONSTRAINT_ICON_SIZE_PX = 22;
// Texture resolution: several times the drawn size, so it stays crisp on a
// high-density display.
const RASTER_PX = 72;

// Which way from its anchor a marker sits, in screen terms (x right, y up).
export const ICON_UP_RIGHT = { x: 1, y: 1 };
export const ICON_RIGHT = { x: 1, y: 0 };
export const ICON_ABOVE = { x: 0, y: 1 };

// Where the marker's CENTRE sits relative to its anchor, in screen pixels with
// y pointing down (the hit tests work in client coordinates).
export const iconScreenOffset = (dir) => {
  const reach = CONSTRAINT_ICON_OFFSET_PX + CONSTRAINT_ICON_SIZE_PX / 2;
  return { x: dir.x * reach, y: dir.y ? -dir.y * reach : 0 };
};

// The sprite's `center` for a direction: the anchor sits OFFSET pixels outside
// the marker's near edge, or mid-way along an axis the marker isn't pushed on.
const centerFor = (d) =>
  d === 0
    ? 0.5
    : d > 0
      ? -CONSTRAINT_ICON_OFFSET_PX / CONSTRAINT_ICON_SIZE_PX
      : 1 + CONSTRAINT_ICON_OFFSET_PX / CONSTRAINT_ICON_SIZE_PX;

// One canvas per artwork and look.  Every sprite gets its OWN texture over the
// shared canvas: rebuilding a sketch disposes its markers' textures, and that
// must never free the picture another marker is still showing.
const looks = new Map();

const PLATES = {
  light: { fill: "rgba(255,255,255,0.92)", stroke: "rgba(40,30,70,0.25)" },
  dark: { fill: "rgba(34,32,40,0.92)", stroke: "rgba(255,255,255,0.25)" },
};

function paint(look) {
  const { canvas, image, theme, selected } = look;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, RASTER_PX, RASTER_PX);
  const plate = PLATES[theme === "light" ? "light" : "dark"];
  const selectColor = toCssHex(sketchSelectedColorFor(theme));
  const inset = RASTER_PX * 0.04;
  const size = RASTER_PX - 2 * inset;
  ctx.beginPath();
  ctx.roundRect(inset, inset, size, size, RASTER_PX * 0.2);
  ctx.fillStyle = plate.fill;
  ctx.fill();
  if (selected) {
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = selectColor;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  ctx.lineWidth = RASTER_PX * (selected ? 0.07 : 0.03);
  ctx.strokeStyle = selected ? selectColor : plate.stroke;
  ctx.stroke();
  if (image) {
    const pad = RASTER_PX * 0.12;
    ctx.drawImage(image, pad, pad, RASTER_PX - 2 * pad, RASTER_PX - 2 * pad);
  }
}

function lookFor(type, theme, selected) {
  const key = `${type}|${theme}|${selected ? "sel" : ""}`;
  let look = looks.get(key);
  if (look) return look;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = RASTER_PX;
  look = { canvas, image: null, theme, selected, textures: new Set() };
  looks.set(key, look);
  paint(look);
  // The artwork arrives asynchronously (an <img> decoding the SVG); markers
  // already made from this look are refreshed when it does.
  const svg = renderToStaticMarkup(
    React.createElement(CONSTRAINT_ICON_ART[type], { size: RASTER_PX }),
  );
  const image = new Image();
  image.onload = () => {
    look.image = image;
    paint(look);
    for (const ref of look.textures) {
      const texture = ref.deref();
      if (texture) texture.needsUpdate = true;
      else look.textures.delete(ref);
    }
    requestRender();
  };
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return look;
}

function textureFor(type, theme, selected) {
  // Unit tests build markers under Node, where there is no canvas to draw on.
  if (typeof document === "undefined") return new THREE.Texture();
  const look = lookFor(type, theme, selected);
  const texture = new THREE.CanvasTexture(look.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  look.textures.add(new WeakRef(texture));
  return texture;
}

// A marker for a constraint `type`, placed `dir` of its anchor.  The caller
// positions it on the anchor and tags it.
export function makeConstraintIconSprite(type, dir, theme) {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: textureFor(type, theme, false),
      depthTest: false,
      transparent: true,
    }),
  );
  sprite.center.set(centerFor(dir.x), centerFor(dir.y));
  sprite.renderOrder = 1010;
  sprite.frustumCulled = false;
  sprite.userData.screenIcon = {
    type,
    theme,
    sizePx: CONSTRAINT_ICON_SIZE_PX,
    offsetPx: iconScreenOffset(dir),
  };
  return sprite;
}

// Tie a marker to a value label: it then sits OFFSET pixels beside the label's
// text -- to its right (side 1) or left (side -1) -- instead of on its own
// anchor, which is the label's centre.  The text's width on screen changes with
// the view, so the render loop re-places it every frame (placeBesideLabel).
export function besideLabel(sprite, label, side = 1) {
  sprite.userData.screenIcon.label = label;
  sprite.userData.screenIcon.side = side;
}

export function placeBesideLabel(sprite, labelHalfWidthPx) {
  const icon = sprite.userData.screenIcon;
  const S = CONSTRAINT_ICON_SIZE_PX;
  const reach = labelHalfWidthPx + CONSTRAINT_ICON_OFFSET_PX;
  sprite.center.set(icon.side < 0 ? 1 + reach / S : -reach / S, 0.5);
  icon.offsetPx = { x: icon.side * (reach + S / 2), y: 0 };
}

// Show a marker as selected (or not): a plate filled with the selection colour.
export function setConstraintIconSelected(sprite, selected) {
  const icon = sprite.userData.screenIcon;
  const { type, theme } = icon;
  icon.selected = selected;
  sprite.material.map?.dispose();
  sprite.material.map = textureFor(type, theme, selected);
  sprite.material.needsUpdate = true;
}

// Where a constraint's clickable marker is on screen, in client pixels: its
// anchor projected, plus the marker's own offset (none for the line-drawn
// markers and dimension hotspots, which sit on their anchor).
const _p = new THREE.Vector3();
export function constraintIconScreenPos(obj, sketchMesh, camera, rect) {
  const lp = obj.userData.constraintIconLocalPos;
  if (!lp) return null;
  _p.set(lp.x, lp.y, 0.005)
    .applyQuaternion(sketchMesh.quaternion)
    .add(sketchMesh.position)
    .project(camera);
  const off = obj.userData.screenIcon?.offsetPx;
  return {
    x: ((_p.x + 1) / 2) * rect.width + rect.left + (off?.x ?? 0),
    y: ((-_p.y + 1) / 2) * rect.height + rect.top + (off?.y ?? 0),
  };
}
