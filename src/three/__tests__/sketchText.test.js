// Text shape geometry: font outlines, sizing, and the shape-level integration
// (translate moves the anchor; the cached bbox tracks the ink size).

import { describe, it, expect } from "vitest";
import {
  TEXT_FONTS,
  DEFAULT_FONT_ID,
  textToContours,
  measureText,
  makeTextShape,
  textShapeContours,
  enumerateSystemFonts,
  fontSamplePath,
  ensureFontLoaded,
  isFontAvailable,
} from "../sketchText.js";
import { translateShape } from "../sketchGeometry.js";

describe("sketchText", () => {
  it("bundles selectable fonts including the default", () => {
    expect(TEXT_FONTS.length).toBeGreaterThan(1);
    expect(TEXT_FONTS.map((f) => f.id)).toContain(DEFAULT_FONT_ID);
  });

  it("turns a string into closed glyph contours", () => {
    const contours = textToContours("Hi", 1, DEFAULT_FONT_ID);
    // H + i-stem + i-dot = 3 contours, each a non-trivial loop.
    expect(contours.length).toBeGreaterThanOrEqual(3);
    expect(contours.every((c) => c.length >= 3)).toBe(true);
  });

  it("returns no contours for blank text or non-positive size", () => {
    expect(textToContours("", 1, DEFAULT_FONT_ID)).toEqual([]);
    expect(textToContours("A", 0, DEFAULT_FONT_ID)).toEqual([]);
  });

  it("measures larger height for more lines", () => {
    const one = measureText("A", 1, DEFAULT_FONT_ID);
    const two = measureText("A\nA", 1, DEFAULT_FONT_ID);
    expect(one.w).toBeGreaterThan(0);
    expect(two.h).toBeGreaterThan(one.h * 1.5);
  });

  it("makeTextShape caches the ink size and tags the type", () => {
    const s = makeTextShape({
      text: "Ab",
      height: 2,
      font: DEFAULT_FONT_ID,
      x: 5,
      y: 7,
    });
    expect(s.type).toBe("text");
    expect(s.w).toBeGreaterThan(0);
    expect(s.h).toBeGreaterThan(0);
    expect({ x: s.x, y: s.y }).toEqual({ x: 5, y: 7 });
  });

  it("anchors the contours at the top-left of the ink box", () => {
    const s = makeTextShape({
      text: "Ab",
      height: 2,
      font: DEFAULT_FONT_ID,
      x: 5,
      y: 7,
    });
    const contours = textShapeContours(s);
    let minX = Infinity,
      maxY = -Infinity;
    for (const c of contours)
      for (const p of c) {
        minX = Math.min(minX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    // top-left of the ink box sits at the anchor
    expect(minX).toBeCloseTo(5, 5);
    expect(maxY).toBeCloseTo(7, 5);
  });

  it("caches glyph contours on the shape for font-free re-rendering", () => {
    const s = makeTextShape({
      text: "o",
      height: 2,
      font: DEFAULT_FONT_ID,
      x: 0,
      y: 0,
    });
    // 'o' has an outer ring and an inner counter (hole) → 2 contours.
    expect(s.contours.length).toBe(2);
    // textShapeContours uses the stored contours without re-parsing the font.
    const stripped = { ...s, text: "", font: "missing" };
    expect(textShapeContours(stripped).length).toBe(2);
  });

  it("degrades gracefully without the Local Font Access API", async () => {
    expect(await enumerateSystemFonts()).toEqual([]); // no window in node
    expect(await ensureFontLoaded(DEFAULT_FONT_ID)).toBe(true); // bundled
    expect(await ensureFontLoaded("sys:Nope")).toBe(false); // unknown system
  });

  it("reports only exactly-available fonts (no silent default fallback)", () => {
    // So a resolution-change re-tessellation won't rebuild text in the wrong font.
    expect(isFontAvailable(DEFAULT_FONT_ID)).toBe(true); // built-in
    expect(isFontAvailable("sys:NotLoaded")).toBe(false); // system, not loaded
    expect(isFontAvailable(null)).toBe(false);
  });

  it("coarsens glyph outlines at a larger simplification tolerance", () => {
    const pts = (s) => s.contours.reduce((n, c) => n + c.length, 0);
    const fine = makeTextShape({
      text: "Sample",
      height: 4,
      font: DEFAULT_FONT_ID,
      x: 0,
      y: 0,
      tolerance: 0.001, // print-like deviation
    });
    const coarse = makeTextShape({
      text: "Sample",
      height: 4,
      font: DEFAULT_FONT_ID,
      x: 0,
      y: 0,
      tolerance: 0.05, // preview-like deviation
    });
    expect(coarse.contourTol).toBe(0.05);
    // A preview deviation should drop the extruded letter to a fraction of the
    // point count, which is the whole point of the resolution toggle for text.
    expect(pts(coarse)).toBeLessThan(pts(fine) * 0.5);
    // ...while leaving the ink size unchanged (bbox is full-detail).
    expect(coarse.w).toBeCloseTo(fine.w, 6);
    expect(coarse.h).toBeCloseTo(fine.h, 6);
  });

  it("translateShape moves a text shape by its anchor", () => {
    const s = makeTextShape({
      text: "x",
      height: 1,
      font: DEFAULT_FONT_ID,
      x: 1,
      y: 2,
    });
    const m = translateShape(s, 3, -4);
    expect({ x: m.x, y: m.y }).toEqual({ x: 4, y: -2 });
    expect(m.w).toBe(s.w); // size unchanged by a move
  });

  // The font list previews each face.  An installed family can be drawn by
  // name in CSS, but a BUNDLED font is typeface JSON that CSS knows nothing
  // about -- its preview has to be traced from the same outlines the sketch
  // uses, or the list would show one typeface under another's name.
  describe("font list previews", () => {
    it("draws a bundled font's sample from its own outlines", () => {
      const a = fontSamplePath("helvetiker", "Sample", 16);
      expect(a.d.startsWith("M"), "an SVG path").toBe(true);
      expect(a.width).toBeGreaterThan(0);
      expect(a.height).toBeGreaterThan(0);
      // Different faces trace different outlines for the same word.
      const b = fontSamplePath("gentilis", "Sample", 16);
      expect(b.d).not.toBe(a.d);
    });

    it("is drawn y-down, inside the box it reports", () => {
      // SVG's y grows downward, the font's grows up; every point has to land
      // inside the reported box or the preview is clipped or floats away.
      const { d, width, height } = fontSamplePath("helvetiker", "Hg", 16);
      const nums = d.replace(/[MLZ]/g, " ").trim().split(/[\s]+/).map(Number);
      const xs = nums.filter((_, i) => i % 2 === 0);
      const ys = nums.filter((_, i) => i % 2 === 1);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(-0.01);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(-0.01);
      expect(Math.max(...xs)).toBeLessThanOrEqual(width + 0.01);
      expect(Math.max(...ys)).toBeLessThanOrEqual(height + 0.01);
    });

    it("returns nothing for a font it cannot draw", () => {
      // An unparsed system font falls back to the default face, so the only
      // empty case is text with no ink.
      expect(fontSamplePath("helvetiker", "   ", 16)).toBeNull();
    });
  });
});
