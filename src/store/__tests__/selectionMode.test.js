import { describe, it, expect } from "vitest";
import { effectiveSelectionTypes } from "../selectionMode.js";

const base = {
  selObject: true,
  selFace: false,
  selEdge: false,
  selPoint: false,
  selectionOverride: null,
};

describe("effectiveSelectionTypes", () => {
  it("object mode greys the sub-types", () => {
    expect(effectiveSelectionTypes(base)).toMatchObject({
      object: true,
      face: false,
      edge: false,
      point: false,
      overridden: false,
    });
  });

  it("with object off, the sub-type toggles decide", () => {
    const s = { ...base, selObject: false, selFace: true, selPoint: true };
    expect(effectiveSelectionTypes(s)).toMatchObject({
      object: false,
      face: true,
      edge: false,
      point: true,
    });
  });

  it("a tool override wins over the user toggles and disables object", () => {
    const s = {
      ...base,
      selObject: true,
      selFace: false,
      selectionOverride: ["face"],
    };
    expect(effectiveSelectionTypes(s)).toMatchObject({
      object: false,
      face: true,
      edge: false,
      point: false,
      overridden: true,
    });
  });

  it("an object override (mirror/pattern/origin) locks to object mode", () => {
    const s = {
      ...base,
      selObject: false,
      selFace: true,
      selectionOverride: ["object"],
    };
    expect(effectiveSelectionTypes(s)).toMatchObject({
      object: true,
      face: false,
      edge: false,
      point: false,
      overridden: true,
    });
  });

  it("chamfer's edge+face override enables exactly those", () => {
    const s = { ...base, selectionOverride: ["edge", "face"] };
    const eff = effectiveSelectionTypes(s);
    expect(eff.edge).toBe(true);
    expect(eff.face).toBe(true);
    expect(eff.point).toBe(false);
    expect(eff.object).toBe(false);
  });

  it("the Split tool derives an object lock", () => {
    const s = { ...base, selObject: false, selFace: true, splitTool: {} };
    expect(effectiveSelectionTypes(s)).toMatchObject({
      object: true,
      overridden: true,
    });
  });

  it("the Plane tool derives a face lock, points-mode a point lock", () => {
    expect(effectiveSelectionTypes({ ...base, planeTool: {} })).toMatchObject({
      face: true,
      overridden: true,
    });
    expect(
      effectiveSelectionTypes({ ...base, planePickActive: "points" }),
    ).toMatchObject({ point: true, overridden: true });
    expect(
      effectiveSelectionTypes({ ...base, planePickActive: "face" }),
    ).toMatchObject({ face: true, overridden: true });
  });
});
