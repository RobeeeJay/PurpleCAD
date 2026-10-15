// Text → vector outlines for the sketch "text" shape.  Uses three's FontLoader
// with a few bundled typeface fonts to turn a string (+ size + font) into closed
// contour polylines in sketch-local coordinates.  No store/scene dependency —
// pure geometry, so it's safe to import from rendering, preview, and the store.

import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
// Vendored from three@0.180 — three 0.181+ no longer ships examples/fonts in
// the npm package.  Same SIL-licensed typeface JSONs, served from our bundle.
import helvetiker from "../assets/fonts/helvetiker_regular.typeface.json";
import helvetikerBold from "../assets/fonts/helvetiker_bold.typeface.json";
import optimer from "../assets/fonts/optimer_regular.typeface.json";
import gentilis from "../assets/fonts/gentilis_regular.typeface.json";

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
let systemFontData = null; // Map<family, FontData>, only cached once non-empty
let systemFontPromise = null; // in-flight queryLocalFonts(), shared by callers
const loadedSystemFonts = new Map(); // id → parsed Font

// List installed font families (after the bundled ones). Returns [] when the
// API or permission is unavailable, so the bundled fonts always work.
//
// queryLocalFonts() is permission-gated and, on its first call, slow — the
// original code cached whatever the FIRST call produced, so a not-yet-granted
// permission (or an empty/failed result) poisoned the cache and the dialog was
// stuck on just the four bundled fonts.  Instead: share one in-flight query,
// and only cache a NON-empty result — an empty/failed attempt clears the promise
// so the next open (once permission is granted / the gesture lands) retries.
export async function enumerateSystemFonts() {
  if (typeof window === "undefined" || !window.queryLocalFonts) return [];
  if (!systemFontData) {
    if (!systemFontPromise) {
      systemFontPromise = (async () => {
        const fonts = await window.queryLocalFonts();
        const map = new Map();
        for (const f of fonts) {
          // Keep one representative file per family, preferring its Regular cut.
          const have = map.get(f.family);
          if (!have || /regular|book/i.test(f.style || ""))
            map.set(f.family, f);
        }
        return map;
      })();
    }
    try {
      const map = await systemFontPromise;
      if (map.size) systemFontData = map;
      else {
        systemFontPromise = null; // empty (permission pending) — stay retryable
        return [];
      }
    } catch {
      systemFontPromise = null; // failed — let the next open try again
      return [];
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
    // Lazy import: the vendored TTFLoader extends THREE.Loader at module scope,
    // which breaks unit tests that partially mock "three"; this path only runs
    // when a user picks a system TTF font, so defer loading until then.
    const { TTFLoader } = await import("./vendor/TTFLoader.js");
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

// True only when the EXACT requested font is available (a loaded system font or
// a built-in) — NOT the silent default fallback.  Callers that regenerate cached
// glyph contours (eg the resolution-change re-tessellation) check this so a
// not-yet-loaded system font doesn't quietly rebuild the text in the default
// font while the shape still names the original.
export function isFontAvailable(fontId) {
  return !!(fontId && (loadedSystemFonts.has(fontId) || FONT_BY_ID[fontId]));
}
const LINE_SPACING = 1.35; // baseline-to-baseline as a multiple of the font size

// Subdivisions per font curve segment when sampling glyph outlines.  Fixed and
// generous so the print path stays smooth; the print/preview face count is then
// governed by simplifyLoop's deviation tolerance, not by this.
const SOURCE_DIVISIONS = 12;

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

// Perpendicular distance from p to the infinite line through a,b.
function perpDist(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Ramer–Douglas–Peucker on a (closing-point-stripped) loop: drop vertices that
// sit within `tol` of the chord spanning their neighbours.  Typeface glyphs are
// emitted as many short segments — even straight runs get subdivided — so
// without this an extruded letter has hundreds of faces regardless of
// resolution.  `tol` is an absolute deviation in sketch units, so the precision
// setting (preview vs print mm) directly drives how coarse the text is.
function simplifyLoop(pts, tol) {
  if (!(tol > 0) || pts.length < 4) return pts;
  const n = pts.length;
  const keep = new Array(n).fill(false);
  keep[0] = keep[n - 1] = true;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    let maxD = -1,
      idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = perpDist(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol && idx > 0) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out = pts.filter((_, i) => keep[i]);
  return out.length >= 3 ? out : pts;
}

// Closed contour polylines for `text` at the given font size, baseline of the
// first line at the origin, glyphs reading rightward (+x) and lines stacking
// downward (-y).  Each contour (glyph outer ring and each hole) is its own loop.
// `tolerance` (sketch units) simplifies each loop; 0 keeps full detail.
export function textToContours(text, size, fontId, tolerance = 0) {
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
      const add = (poly) =>
        out.push(
          simplifyLoop(
            cleanLoop(poly.map((p) => ({ x: p.x, y: p.y + dy }))),
            tolerance,
          ),
        );
      for (const s of shapes) {
        const { shape, holes } = s.extractPoints(SOURCE_DIVISIONS);
        add(shape);
        for (const h of holes) add(h);
      }
    });
  return out.filter((c) => c.length >= 3);
}

// Glyph loops for `text` built from the font's own curves: each loop's points
// AND the exact curve runs under them (closedLoops.js), so an extruded letter
// is built from its beziers rather than from the points.  A line is one edge;
// a bezier is sampled to `tolerance` (sketch units; 0 = SOURCE_DIVISIONS) and
// recorded as a run -- a quadratic raised to the cubic it equals.  No
// simplification afterwards: it would drop the vertices the runs index.
export function textToLoops(text, size, fontId, tolerance = 0) {
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
      for (const sh of shapes)
        for (const path of [sh, ...sh.holes]) {
          const loop = pathLoop(path, dy, tolerance);
          if (loop.pts.length >= 3) out.push(loop);
        }
    });
  return out;
}

const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-7;

function pathLoop(path, dy, tol) {
  const P = (v) => ({ x: v.x, y: v.y + dy });
  const lerp = (a, b, t) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const pts = [];
  const runs = [];
  for (const c of path.curves) {
    let ctrl = null;
    if (c.isQuadraticBezierCurve) {
      const [q0, q1, q2] = [P(c.v0), P(c.v1), P(c.v2)];
      ctrl = [q0, lerp(q0, q1, 2 / 3), lerp(q2, q1, 2 / 3), q2];
    } else if (c.isCubicBezierCurve) {
      ctrl = [P(c.v0), P(c.v1), P(c.v2), P(c.v3)];
    }
    const start = ctrl ? ctrl[0] : P(c.getPoint(0));
    if (!pts.length || !near(pts[pts.length - 1], start)) pts.push(start);
    if (!ctrl || ctrl.every((q) => near(q, ctrl[0]))) continue;
    const n = bezierDivisions(ctrl, tol);
    const s0 = pts.length - 1;
    for (let i = 1; i < n; i++) pts.push(cubicAt(ctrl, i / n));
    const [p0, p1, p2, p3] = ctrl;
    runs.push({ type: "bezier", start: s0, count: n, p0, p1, p2, p3 });
  }
  // The path closes on its first point: drop a repeat of it.
  if (pts.length > 1 && near(pts[0], pts[pts.length - 1])) {
    pts.pop();
    // A run ending on the dropped point now ends on vertex 0 -- the same point.
  }
  return { pts, runs };
}

// Pieces for a cubic so no chord strays more than `tol` from it: the chord
// error of n equal-t pieces is about (control deviation) / n^2.
function bezierDivisions([p0, p1, p2, p3], tol) {
  if (!(tol > 0)) return SOURCE_DIVISIONS;
  const cx = p3.x - p0.x,
    cy = p3.y - p0.y;
  const cl = Math.hypot(cx, cy) || 1e-9;
  const dist = (p) => Math.abs((p.x - p0.x) * cy - (p.y - p0.y) * cx) / cl;
  const dev = Math.max(dist(p1), dist(p2));
  return Math.max(2, Math.min(64, Math.ceil(Math.sqrt(dev / tol))));
}

function cubicAt([q0, q1, q2, q3], t) {
  const mt = 1 - t;
  const a = mt * mt * mt,
    b = 3 * mt * mt * t,
    c = 3 * mt * t * t,
    d = t * t * t;
  return {
    x: a * q0.x + b * q1.x + c * q2.x + d * q3.x,
    y: a * q0.y + b * q1.y + c * q2.y + d * q3.y,
  };
}

// A sample of a font drawn as one SVG path, for the font list's preview.  The
// bundled fonts are three.js typeface JSON, not installed families, so CSS
// cannot render them -- their preview has to come from the same outlines the
// sketch is built from, or it would show a DIFFERENT typeface than the one it
// names.  Returns { d, width, height } in a y-down SVG box, or null.
export function fontSamplePath(fontId, sample, height = 16) {
  const contours = textToContours(sample, height, fontId);
  if (contours.length === 0) return null;
  const b = bboxOf(contours);
  if (!isFinite(b.minX)) return null;
  const d = contours
    .map(
      (c) =>
        "M" +
        c
          .map(
            (p) => `${(p.x - b.minX).toFixed(2)} ${(b.maxY - p.y).toFixed(2)}`,
          )
          .join("L") +
        "Z",
    )
    .join("");
  return { d, width: b.maxX - b.minX, height: b.maxY - b.minY };
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
export function measureText(text, size, fontId) {
  const b = bboxOf(textToContours(text, size, fontId));
  if (!isFinite(b.minX)) return { w: 0, h: 0 };
  return { w: b.maxX - b.minX, h: b.maxY - b.minY };
}

// Anchor-relative contours (top-left of the ink box at the origin, reading
// right/down) plus the ink size.  Cached on the shape so rendering AND region
// detection use plain stored geometry — no font re-parse, and region detection
// stays font-free (important: it runs in font-less/mocked environments).  The
// bbox comes from full-detail outlines so w/h stays stable across resolutions;
// only the stored contours are simplified to `tolerance`.
function relContours(text, height, font, tolerance = 0) {
  const full = textToContours(text, height, font);
  if (full.length === 0) return { contours: [], contourCurves: [], w: 0, h: 0 };
  const b = bboxOf(full);
  const at = (p) => ({ x: p.x - b.minX, y: p.y - b.maxY });
  const loops = textToLoops(text, height, font, tolerance);
  return {
    contours: loops.map((l) => l.pts.map(at)),
    // Each contour's curve runs, the same anchor-relative frame.
    contourCurves: loops.map((l) =>
      l.runs.map((r) => ({
        ...r,
        p0: at(r.p0),
        p1: at(r.p1),
        p2: at(r.p2),
        p3: at(r.p3),
      })),
    ),
    w: b.maxX - b.minX,
    h: b.maxY - b.minY,
  };
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
// glyph contours.  `tolerance` is the active resolution's simplification
// deviation in sketch units (cached as contourTol so a resolution change can
// detect staleness and re-simplify).
export function makeTextShape({ text, height, font, x, y, tolerance = 0 }) {
  const { contours, contourCurves, w, h } = relContours(
    text,
    height,
    font,
    tolerance,
  );
  return {
    type: "text",
    text,
    height,
    font,
    x,
    y,
    w,
    h,
    contours,
    contourCurves,
    contourTol: tolerance,
  };
}
