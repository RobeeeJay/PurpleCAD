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
  ensureFontLoaded,
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

  it("samples glyph curves more finely at higher divisions", () => {
    const coarse = makeTextShape({
      text: "o",
      height: 4,
      font: DEFAULT_FONT_ID,
      x: 0,
      y: 0,
      divisions: 3,
    });
    const fine = makeTextShape({
      text: "o",
      height: 4,
      font: DEFAULT_FONT_ID,
      x: 0,
      y: 0,
      divisions: 18,
    });
    const pts = (s) => s.contours.reduce((n, c) => n + c.length, 0);
    expect(coarse.contourDivisions).toBe(3);
    expect(fine.contourDivisions).toBe(18);
    expect(pts(fine)).toBeGreaterThan(pts(coarse));
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
});
