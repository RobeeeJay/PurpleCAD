// Text → vector outlines for the sketch "text" shape.  Uses three's FontLoader
// with a few bundled typeface fonts to turn a string (+ size + font) into closed
// contour polylines in sketch-local coordinates.  No store/scene dependency —
// pure geometry, so it's safe to import from rendering, preview, and the store.

import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import helvetiker from "three/examples/fonts/helvetiker_regular.typeface.json";
import helvetikerBold from "three/examples/fonts/helvetiker_bold.typeface.json";
import optimer from "three/examples/fonts/optimer_regular.typeface.json";
import gentilis from "three/examples/fonts/gentilis_regular.typeface.json";

const loader = new FontLoader();

// The fonts offered in the Text dialog's dropdown.
export const TEXT_FONTS = [
  { id: "helvetiker", label: "Helvetiker", font: loader.parse(helvetiker) },
  {
    id: "helvetiker_bold",
    label: "Helvetiker Bold",
    font: loader.parse(helvetikerBold),
  },
  { id: "optimer", label: "Optimer", font: loader.parse(optimer) },
  { id: "gentilis", label: "Gentilis", font: loader.parse(gentilis) },
];
export const DEFAULT_FONT_ID = "helvetiker";

const FONT_BY_ID = Object.fromEntries(TEXT_FONTS.map((f) => [f.id, f.font]));
const LINE_SPACING = 1.35; // baseline-to-baseline as a multiple of the font size

// Closed contour polylines for `text` at the given font size, baseline of the
// first line at the origin, glyphs reading rightward (+x) and lines stacking
// downward (-y).  Each contour (glyph outer ring and each hole) is its own loop.
export function textToContours(text, size, fontId, divisions = 6) {
  const font = FONT_BY_ID[fontId] || FONT_BY_ID[DEFAULT_FONT_ID];
  if (!font || !(size > 0)) return [];
  const out = [];
  String(text)
    .split("\n")
    .forEach((line, li) => {
      if (!line) return;
      let shapes;
      try {
        shapes = font.generateShapes(line, size);
      } catch {
        return;
      }
      const dy = -li * size * LINE_SPACING;
      for (const s of shapes) {
        const { shape, holes } = s.extractPoints(divisions);
        out.push(shape.map((p) => ({ x: p.x, y: p.y + dy })));
        for (const h of holes)
          out.push(h.map((p) => ({ x: p.x, y: p.y + dy })));
      }
    });
  return out;
}

function bboxOf(contours) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const c of contours)
    for (const p of c) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  return { minX, minY, maxX, maxY };
}

// Ink width/height of the rendered text, in sketch units.  Cached on the shape
// (as w/h) so the bounding box can be drawn without re-parsing the font.
export function measureText(text, size, fontId, divisions = 6) {
  const b = bboxOf(textToContours(text, size, fontId, divisions));
  if (!isFinite(b.minX)) return { w: 0, h: 0 };
  return { w: b.maxX - b.minX, h: b.maxY - b.minY };
}

// Contours for a committed text shape, positioned so the shape's (x, y) anchor
// is the top-left corner of the text's ink bounding box.
export function textShapeContours(shape, divisions = 6) {
  const base = textToContours(shape.text, shape.height, shape.font, divisions);
  if (base.length === 0) return [];
  const b = bboxOf(base);
  const ox = shape.x - b.minX;
  const oy = shape.y - b.maxY;
  return base.map((c) => c.map((p) => ({ x: p.x + ox, y: p.y + oy })));
}

// Build a complete text shape (anchor at top-left) with its cached ink size.
export function makeTextShape({ text, height, font, x, y }) {
  const { w, h } = measureText(text, height, font);
  return { type: "text", text, height, font, x, y, w, h };
}
