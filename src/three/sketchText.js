// Text → vector outlines for the sketch "text" shape.  Uses three's FontLoader
// with a few bundled typeface fonts to turn a string (+ size + font) into closed
// contour polylines in sketch-local coordinates.  No store/scene dependency —
// pure geometry, so it's safe to import from rendering, preview, and the store.

import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TTFLoader } from "three/examples/jsm/loaders/TTFLoader.js";
import helvetiker from "three/examples/fonts/helvetiker_regular.typeface.json";
import helvetikerBold from "three/examples/fonts/helvetiker_bold.typeface.json";
import optimer from "three/examples/fonts/optimer_regular.typeface.json";
import gentilis from "three/examples/fonts/gentilis_regular.typeface.json";

const loader = new FontLoader();

// The always-available bundled fonts (offered first in the dialog dropdown).
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

// ── Installed system fonts (Local Font Access API) ───────────────────────────
// queryLocalFonts() lists installed fonts and hands back each font file's blob.
// We enumerate names up front and parse a font's outlines (TTF/OTF → typeface)
// only when it's actually selected. System font ids are "sys:<Family>".
const SYS_PREFIX = "sys:";
let systemFontData = null; // Map<family, FontData> for lazy blob loading
const loadedSystemFonts = new Map(); // id → parsed Font

// List installed font families (after the bundled ones). Returns [] when the
// API or permission is unavailable, so the bundled fonts always work.
export async function enumerateSystemFonts() {
  if (typeof window === "undefined" || !window.queryLocalFonts) return [];
  if (!systemFontData) {
    try {
      const fonts = await window.queryLocalFonts();
      systemFontData = new Map();
      for (const f of fonts) {
        // Keep one representative file per family, preferring its Regular cut.
        const have = systemFontData.get(f.family);
        if (!have || /regular|book/i.test(f.style || ""))
          systemFontData.set(f.family, f);
      }
    } catch {
      systemFontData = new Map();
    }
  }
  return [...systemFontData.keys()]
    .sort()
    .map((family) => ({ id: SYS_PREFIX + family, label: family }));
}

// Parse and cache a system font's outlines on demand. Returns true once the
// font is usable (bundled fonts are always ready).
export async function ensureFontLoaded(id) {
  if (!id || !id.startsWith(SYS_PREFIX)) return true;
  if (loadedSystemFonts.has(id)) return true;
  const fd = systemFontData?.get(id.slice(SYS_PREFIX.length));
  if (!fd) return false;
  try {
    const buf = await (await fd.blob()).arrayBuffer();
    const font = loader.parse(new TTFLoader().parse(buf));
    loadedSystemFonts.set(id, font);
    return true;
  } catch {
    return false;
  }
}

function getFont(fontId) {
  return (
    loadedSystemFonts.get(fontId) ||
    FONT_BY_ID[fontId] ||
    FONT_BY_ID[DEFAULT_FONT_ID]
  );
}
const LINE_SPACING = 1.35; // baseline-to-baseline as a multiple of the font size

// Drop consecutive-duplicate and closing-duplicate points so the loop is a
// clean open polygon — font glyph contours repeat the start point at the end,
// which makes a zero-length wire segment that OCC's makeExtrude rejects.
function cleanLoop(pts) {
  const out = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-7) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0],
      b = out[out.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-7) out.pop();
  }
  return out;
}

// Closed contour polylines for `text` at the given font size, baseline of the
// first line at the origin, glyphs reading rightward (+x) and lines stacking
// downward (-y).  Each contour (glyph outer ring and each hole) is its own loop.
export function textToContours(text, size, fontId, divisions = 6) {
  const font = getFont(fontId);
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
        out.push(cleanLoop(shape.map((p) => ({ x: p.x, y: p.y + dy }))));
        for (const h of holes)
          out.push(cleanLoop(h.map((p) => ({ x: p.x, y: p.y + dy }))));
      }
    });
  return out.filter((c) => c.length >= 3);
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

// Anchor-relative contours (top-left of the ink box at the origin, reading
// right/down) plus the ink size.  Cached on the shape so rendering AND region
// detection use plain stored geometry — no font re-parse, and region detection
// stays font-free (important: it runs in font-less/mocked environments).
function relContours(text, height, font, divisions = 6) {
  const base = textToContours(text, height, font, divisions);
  if (base.length === 0) return { contours: [], w: 0, h: 0 };
  const b = bboxOf(base);
  const contours = base.map((c) =>
    c.map((p) => ({ x: p.x - b.minX, y: p.y - b.maxY })),
  );
  return { contours, w: b.maxX - b.minX, h: b.maxY - b.minY };
}

// Absolute contours for a committed text shape (anchor = top-left).  Uses the
// stored contours when present, falling back to a font re-parse.
export function textShapeContours(shape) {
  const base =
    shape.contours ||
    relContours(shape.text, shape.height, shape.font).contours;
  return base.map((c) =>
    c.map((p) => ({ x: p.x + shape.x, y: p.y + shape.y })),
  );
}

// Build a complete text shape (anchor at top-left) with its cached ink size and
// glyph contours.
export function makeTextShape({ text, height, font, x, y }) {
  const { contours, w, h } = relContours(text, height, font);
  return { type: "text", text, height, font, x, y, w, h, contours };
}
