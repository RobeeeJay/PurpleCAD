// evalValue underpins the modify-input value parsing: it accepts plain numbers
// and variable formulas, and returns NaN for blank / unparseable input so the
// callers can disable Confirm and skip the live preview.

import { describe, it, expect } from "vitest";
import { evalValue, PREVIEW_DEBOUNCE_MS } from "../inputs.jsx";

const vars = [
  { name: "width", formula: "20" },
  { name: "half", formula: "width / 2" },
];

describe("evalValue", () => {
  it("parses plain numbers (including negative / decimal)", () => {
    expect(evalValue("5", vars)).toBe(5);
    expect(evalValue("-2.5", vars)).toBe(-2.5);
  });

  it("resolves variable formulas", () => {
    expect(evalValue("width", vars)).toBe(20);
    expect(evalValue("half", vars)).toBe(10);
    expect(evalValue("width / 4 + 1", vars)).toBe(6);
  });

  it("returns NaN for blank, whitespace, or unparseable input", () => {
    expect(evalValue("", vars)).toBeNaN();
    expect(evalValue("   ", vars)).toBeNaN();
    expect(evalValue(null, vars)).toBeNaN();
    expect(evalValue("nope", vars)).toBeNaN(); // unknown identifier
    expect(evalValue("3 +", vars)).toBeNaN(); // syntax error
  });

  it("uses a 350ms debounce constant", () => {
    expect(PREVIEW_DEBOUNCE_MS).toBe(350);
  });
});
