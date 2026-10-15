import { describe, it, expect } from "vitest";
import {
  diameterToRadiusFormula,
  evaluateFormula,
  radiusToDiameterFormula,
  variablesToMap,
} from "../formulas.js";

describe("evaluateFormula", () => {
  it("evaluates bare numbers", () => {
    expect(evaluateFormula("0")).toBe(0);
    expect(evaluateFormula("12.5")).toBe(12.5);
    expect(evaluateFormula("-3")).toBe(-3);
    expect(evaluateFormula(7)).toBe(7);
  });

  it("evaluates basic arithmetic", () => {
    expect(evaluateFormula("1 + 2")).toBe(3);
    expect(evaluateFormula("10 - 4")).toBe(6);
    expect(evaluateFormula("3 * 5")).toBe(15);
    expect(evaluateFormula("20 / 4")).toBe(5);
  });

  it("respects operator precedence", () => {
    expect(evaluateFormula("1 + 2 * 3")).toBe(7);
    expect(evaluateFormula("(1 + 2) * 3")).toBe(9);
    expect(evaluateFormula("12 / 4 - 1")).toBe(2);
    expect(evaluateFormula("2 + 3 * 4 - 5")).toBe(9);
  });

  it("handles unary minus", () => {
    expect(evaluateFormula("-5 + 2")).toBe(-3);
    expect(evaluateFormula("3 * -2")).toBe(-6);
    expect(evaluateFormula("-(2 + 3)")).toBe(-5);
  });

  it("resolves variable references", () => {
    const vars = { width: "10", height: "5" };
    expect(evaluateFormula("width", vars)).toBe(10);
    expect(evaluateFormula("width + height", vars)).toBe(15);
    expect(evaluateFormula("width * 2 + height", vars)).toBe(25);
  });

  it("resolves nested variable references", () => {
    const vars = { a: "2", b: "a * 3", c: "b + a" };
    expect(evaluateFormula("c", vars)).toBe(8);
    expect(evaluateFormula("c * 2", vars)).toBe(16);
  });

  it("returns NaN for direct cycles", () => {
    const vars = { a: "a + 1" };
    expect(Number.isNaN(evaluateFormula("a", vars))).toBe(true);
  });

  it("returns NaN for indirect cycles", () => {
    const vars = { a: "b", b: "c", c: "a" };
    expect(Number.isNaN(evaluateFormula("a", vars))).toBe(true);
  });

  it("returns NaN for unknown identifiers", () => {
    expect(Number.isNaN(evaluateFormula("missing"))).toBe(true);
    expect(Number.isNaN(evaluateFormula("1 + missing"))).toBe(true);
  });

  it("returns NaN for syntax errors", () => {
    expect(Number.isNaN(evaluateFormula("1 +"))).toBe(true);
    expect(Number.isNaN(evaluateFormula("1 + 2)"))).toBe(true);
    expect(Number.isNaN(evaluateFormula("(1 + 2"))).toBe(true);
    expect(Number.isNaN(evaluateFormula("1 2"))).toBe(true);
  });

  it("accepts Map and array-of-entries inputs", () => {
    const arr = [
      { name: "x", formula: "4" },
      { name: "y", formula: "x + 1" },
    ];
    const map = variablesToMap(arr);
    expect(evaluateFormula("y * 2", map)).toBe(10);
  });

  it("treats empty / null formulas as NaN", () => {
    expect(Number.isNaN(evaluateFormula(""))).toBe(true);
    expect(Number.isNaN(evaluateFormula(null))).toBe(true);
    expect(Number.isNaN(evaluateFormula(undefined))).toBe(true);
  });

  // Arithmetic runs through decimal.js, so common decimal cases are exact
  // rather than carrying binary-float noise.
  it("evaluates decimal arithmetic exactly", () => {
    expect(evaluateFormula("0.1 + 0.2")).toBe(0.3);
    expect(evaluateFormula("1/3*3")).toBe(1);
    expect(evaluateFormula("1.005 * 100")).toBe(100.5);
    const map = variablesToMap([{ name: "w", formula: "0.1" }]);
    expect(evaluateFormula("w + 0.2", map)).toBe(0.3);
  });
});

// A circle's dimension is stored as a radius but shown and typed as a
// diameter.  The conversion is display-only, so it must never change the value
// a constraint resolves to, and re-opening then re-confirming a field must give
// back exactly what was stored -- otherwise every edit would wrap the formula
// in another "* 2" and "/ 2".
describe("circle dimensions: radius stored, diameter shown", () => {
  const vars = { a: 3, b: 4, Width: 40, Dia: 10, x: 7 };

  it("doubles a plain number exactly, in decimal", () => {
    expect(radiusToDiameterFormula("5")).toBe("10");
    expect(radiusToDiameterFormula("0.1")).toBe("0.2");
    expect(diameterToRadiusFormula("0.3")).toBe("0.15");
    expect(diameterToRadiusFormula("25")).toBe("12.5");
  });

  it("shows a formula radius as twice that formula", () => {
    expect(radiusToDiameterFormula("R")).toBe("2 * R");
    expect(radiusToDiameterFormula("a + b")).toBe("2 * (a + b)");
  });

  it("stores a typed diameter formula as half of it", () => {
    expect(diameterToRadiusFormula("Dia")).toBe("Dia / 2");
    expect(diameterToRadiusFormula("Dia - 2")).toBe("(Dia - 2) / 2");
    // "2 * a + b" is not 2 * (a + b): it must not be unwrapped.
    expect(diameterToRadiusFormula("2 * a + b")).toBe("(2 * a + b) / 2");
  });

  it("round-trips whatever was stored, so edits never accumulate", () => {
    for (const r of [
      "5",
      "2.5",
      "R",
      "Width / 4",
      "a + b",
      "Dia / 2",
      "(Dia - 2) / 2",
      "2 * x",
    ])
      expect(diameterToRadiusFormula(radiusToDiameterFormula(r)), r).toBe(r);
    for (const d of ["20", "Dia", "Dia - 2", "2 * a + b"])
      expect(radiusToDiameterFormula(diameterToRadiusFormula(d)), d).toBe(d);
  });

  it("never changes the value: shown diameter is exactly twice the radius", () => {
    for (const r of [
      "5",
      "a + b",
      "Width / 4",
      "(Dia - 2) / 2",
      "2 * x",
      "(a + b)",
    ])
      expect(evaluateFormula(radiusToDiameterFormula(r), vars), r).toBe(
        evaluateFormula(r, vars) * 2,
      );
    for (const d of ["20", "Dia", "Dia - 2", "2 * a + b"])
      expect(evaluateFormula(diameterToRadiusFormula(d), vars) * 2, d).toBe(
        evaluateFormula(d, vars),
      );
  });
});
