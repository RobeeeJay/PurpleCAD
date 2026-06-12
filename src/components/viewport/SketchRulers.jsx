// Screen-locked rulers for sketch mode.  Two canvas strips (bottom = sketch
// local X, left = sketch local Y) pinned to the viewport edges; labels show the
// mm offset from the sketch origin and update live as the user pans / zooms.

import React, { useEffect, useRef } from "react";
import * as THREE from "three";
import { MM_PER_UNIT } from "../../three/sceneObjects.js";
import { useStore } from "../../store";
import {
  rulerLabelColorFor,
  rulerTickColorFor,
  toCssHex,
} from "../../three/theme.js";

const RULER_W = 44; // left strip width (px) — keep in sync with Viewport.css
const RULER_H = 22; // bottom strip height (px)
// Width of the Objects/Timeline overlay (.left-panel in App.css) that the
// left-panel sits in front of. The rulers are pushed past it so they stay
// visible to its right instead of being covered by it.
const LEFT_PANEL_W = 250;
const X_AXIS_COLOR = "#ff6666";
const Y_AXIS_COLOR = "#6699ff";

// Pick a "nice" major-tick step in mm (1/2/5 × 10ⁿ) ≈ targetPx apart on screen.
function niceStepMm(mmPerPx, targetPx) {
  const raw = mmPerPx * targetPx;
  if (!(raw > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const c of [1, 2, 5, 10]) if (c * pow >= raw) return c * pow;
  return 10 * pow;
}

// Draw one axis strip.  `origin` is the sketch-origin position along the axis
// (container px), `perUnit` is px per local unit (signed), `lead` is the px
// offset between the canvas's 0 and the container's 0 (RULER_W for the bottom
// strip, 0 for the left strip).
function drawRulerStrip(
  canvas,
  orient,
  cssLen,
  perUnit,
  origin,
  lead,
  dpr,
  theme,
) {
  const ctx = canvas.getContext("2d");
  const cw = orient === "h" ? cssLen : RULER_W;
  const ch = orient === "h" ? RULER_H : cssLen;
  canvas.width = cw * dpr;
  canvas.height = ch * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  // Faint light wash instead of a solid dark strip: keeps the ruler light and
  // lets sketch lines passing under the edge bars stay visible.
  ctx.fillStyle = "rgba(170, 170, 170, 0.15)";
  ctx.fillRect(0, 0, cw, ch);
  const tickColor = toCssHex(rulerTickColorFor(theme));
  const labelColor = toCssHex(rulerLabelColorFor(theme));

  const mmPerPx = MM_PER_UNIT / Math.abs(perUnit);
  const majorMm = niceStepMm(mmPerPx, 70);
  const minorLocal = majorMm / 5 / MM_PER_UNIT;
  // local coordinate at each end of the visible strip
  const locAt = (containerPos) => (containerPos - origin) / perUnit;
  const a = locAt(lead);
  const b = locAt(lead + cssLen);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const startN = Math.floor(lo / minorLocal);
  const endN = Math.ceil(hi / minorLocal);

  ctx.font = "10px monospace";
  ctx.lineWidth = 1;
  for (let n = startN; n <= endN; n++) {
    const localV = n * minorLocal;
    const pos = origin + localV * perUnit - lead; // px within the canvas
    if (pos < 0 || pos > cssLen) continue;
    const major = n % 5 === 0;
    const isOrigin = n === 0;
    const tick = major ? 10 : 5;
    ctx.strokeStyle = isOrigin
      ? orient === "h"
        ? X_AXIS_COLOR
        : Y_AXIS_COLOR
      : tickColor;
    ctx.beginPath();
    if (orient === "h") {
      ctx.moveTo(pos, RULER_H);
      ctx.lineTo(pos, RULER_H - tick);
    } else {
      ctx.moveTo(RULER_W, pos);
      ctx.lineTo(RULER_W - tick, pos);
    }
    ctx.stroke();
    if (major) {
      ctx.fillStyle = isOrigin
        ? orient === "h"
          ? X_AXIS_COLOR
          : Y_AXIS_COLOR
        : labelColor;
      const mm = Math.round(localV * MM_PER_UNIT);
      if (orient === "h") {
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(String(mm), pos, 2);
      } else {
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(String(mm), RULER_W - 12, pos);
      }
    }
  }
}

export default function SketchRulers({
  active,
  cameraRef,
  rendererRef,
  objectsRef,
  selectedId,
}) {
  const hRef = useRef(null);
  const vRef = useRef(null);
  const lastKey = useRef("");

  useEffect(() => {
    if (!active) return undefined;
    const scratch = new THREE.Vector3();
    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const cam = cameraRef.current;
      const renderer = rendererRef.current;
      const mesh = objectsRef.current?.[selectedId];
      const hCanvas = hRef.current;
      const vCanvas = vRef.current;
      if (!cam || !renderer || !mesh || !hCanvas || !vCanvas) return;
      const dom = renderer.domElement;
      const W = dom.clientWidth;
      const H = dom.clientHeight;
      if (W === 0 || H === 0) return;
      const dpr = window.devicePixelRatio || 1;

      const toScreen = (lx, ly) => {
        scratch
          .set(lx, ly, 0)
          .applyQuaternion(mesh.quaternion)
          .add(mesh.position)
          .project(cam);
        return {
          x: ((scratch.x + 1) / 2) * W,
          y: ((-scratch.y + 1) / 2) * H,
        };
      };
      const O = toScreen(0, 0);
      const X = toScreen(1, 0);
      const Y = toScreen(0, 1);
      const ux = X.x - O.x; // px per local unit, horizontal
      const uy = Y.y - O.y; // px per local unit, vertical (usually negative)
      if (Math.abs(ux) < 1e-3 || Math.abs(uy) < 1e-3) return;

      const theme = useStore.getState().theme;
      // Skip redraw when the camera is idle (cheap change-detect).
      const key = `${W}|${H}|${O.x.toFixed(2)}|${O.y.toFixed(2)}|${ux.toFixed(4)}|${uy.toFixed(4)}|${theme}`;
      if (key === lastKey.current) return;
      lastKey.current = key;

      drawRulerStrip(
        hCanvas,
        "h",
        W - LEFT_PANEL_W - RULER_W,
        ux,
        O.x,
        LEFT_PANEL_W + RULER_W,
        dpr,
        theme,
      );
      drawRulerStrip(vCanvas, "v", H, uy, O.y, 0, dpr, theme);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active, selectedId, cameraRef, rendererRef, objectsRef]);

  if (!active) return null;
  return (
    <>
      <canvas ref={hRef} className="sketch-ruler sketch-ruler-bottom" />
      <canvas ref={vRef} className="sketch-ruler sketch-ruler-left" />
    </>
  );
}
