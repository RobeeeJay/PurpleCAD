import { describe, expect, it } from "vitest";
import opentype from "opentype.js";
import { FontLoader } from "three/examples/jsm/loaders/FontLoader.js";
import { TTFLoader } from "../vendor/TTFLoader.js";

// A system font reaches the sketch Text tool only through the vendored
// TTFLoader and opentype.js (sketchText.js#ensureFontLoaded), whose failure is
// a silent `false`.  Nothing else parses a real font file, so an opentype.js or
// three upgrade that broke it would pass every other test.

// One glyph, "A", drawn as a 600 x 700 square in a 1000-unit em.
function squareFont() {
  const path = new opentype.Path();
  path.moveTo(100, 0);
  path.lineTo(700, 0);
  path.lineTo(700, 700);
  path.lineTo(100, 700);
  path.close();
  const notdef = new opentype.Glyph({
    name: ".notdef",
    unicode: 0,
    advanceWidth: 500,
    path: new opentype.Path(),
  });
  const a = new opentype.Glyph({
    name: "A",
    unicode: 65,
    advanceWidth: 800,
    path,
  });
  return new opentype.Font({
    familyName: "Square",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs: [notdef, a],
  }).toArrayBuffer();
}

describe("a font file through the vendored TTFLoader", () => {
  it("turns a glyph's outline into the shape three draws", () => {
    const font = new FontLoader().parse(new TTFLoader().parse(squareFont()));
    // three's TTF conversion works in points: every coordinate is scaled by
    // 100000 / (unitsPerEm * 72), so the drawn square comes back that much
    // bigger at size 1000 (the font's resolution).
    const k = 100000 / (1000 * 72);
    const shapes = font.generateShapes("A", 1000);
    expect(shapes.length).toBe(1);
    const pts = shapes[0].getPoints();
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const box = [
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys),
    ];
    const want = [100, 0, 700, 700].map((v) => Math.round(v * k));
    expect(box, JSON.stringify(pts)).toEqual(want);
  });
});
