import { describe, it, expect } from "vitest";
import {
  effectiveSelectionTypes,
  anyToolActive,
  effectiveSketchSelTypes,
  selectionChainAngle,
} from "../selectionMode.js";

describe("effectiveSketchSelTypes", () => {
  const types = {
    line: true,
    point: true,
    shape: true,
    constraint: true,
    object: false,
  };

  it("passes the user toggles through with no tool (object stays off)", () => {
    const { eff, allowed } = effectiveSketchSelTypes({ sketchSelTypes: types });
    expect(eff).toMatchObject({
      line: true,
      point: true,
      shape: true,
      constraint: true,
      object: false,
    });
    expect(allowed.object).toBeFalsy();
  });

  it("constraint mode allows only points", () => {
    const { eff, allowed } = effectiveSketchSelTypes({
      sketchSelTypes: types,
      sketchConstraintMode: "coincident",
    });
    expect(allowed).toEqual({ point: true });
    expect(eff).toMatchObject({ point: true, line: false, shape: false });
  });

  it("the Project tool forces object on (even if the toggle was off)", () => {
    const { eff, allowed } = effectiveSketchSelTypes({
      sketchSelTypes: types,
      projectTool: {},
    });
    expect(allowed).toEqual({ object: true });
    expect(eff.object).toBe(true);
    expect(eff.line).toBe(false);
  });

  it("returns to the user's kinds once the tool clears", () => {
    // No persisted override: with no tool the result is just the user toggles.
    const { eff } = effectiveSketchSelTypes({ sketchSelTypes: types });
    expect(eff.line).toBe(true);
    expect(eff.object).toBe(false);
  });
});

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

  it("the Split tool locks to objects while picking the body", () => {
    const s = {
      ...base,
      selObject: false,
      selFace: true,
      splitTool: {},
      splitPick: "object",
    };
    expect(effectiveSelectionTypes(s)).toMatchObject({
      object: true,
      face: false,
      overridden: true,
    });
  });

  // It used to hold the object lock through the cut phase too: the widget
  // greyed out faces and hover lit whole bodies, so a face never looked
  // pickable even though a click on one was accepted.
  it("the Split tool locks to faces while picking the cut", () => {
    const s = { ...base, selObject: true, splitTool: {}, splitPick: "cut" };
    expect(effectiveSelectionTypes(s)).toMatchObject({
      object: false,
      face: true,
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

describe("selectionChainAngle", () => {
  const NO_CHAIN = 0.5;
  it("follows the curve angle when chain is on and a face/edge type is on", () => {
    const s = {
      ...base,
      selObject: false,
      selFace: true,
      selChain: true,
      curveDetectionAngleDeg: 12,
    };
    expect(selectionChainAngle(s)).toBe(12);
  });

  it("collapses to a hair when the chain toggle is off", () => {
    const s = {
      ...base,
      selObject: false,
      selEdge: true,
      selChain: false,
      curveDetectionAngleDeg: 12,
    };
    expect(selectionChainAngle(s)).toBe(NO_CHAIN);
  });

  it("collapses when neither face nor edge is selectable, even if chain is remembered on", () => {
    // selChain stays true (remembered) but object mode means no face/edge pick.
    const s = { ...base, selChain: true, curveDetectionAngleDeg: 12 };
    expect(selectionChainAngle(s)).toBe(NO_CHAIN);
  });

  it("uses a face lock from a tool (override) to allow chaining", () => {
    const s = {
      ...base,
      selObject: false,
      selChain: true,
      curveDetectionAngleDeg: 8,
      planeTool: {}, // derives a face lock via effectiveSelectionTypes
    };
    expect(selectionChainAngle(s)).toBe(8);
  });

  it("defaults to the standard angle when no store is provided (unit tests)", () => {
    expect(selectionChainAngle(undefined)).toBe(5);
  });
});

describe("anyToolActive", () => {
  it("is false when no tool is engaged", () => {
    expect(anyToolActive({})).toBe(false);
    expect(anyToolActive({ ...base, selectedId: 3 })).toBe(false);
  });

  it("is true for a guided pick flow (hole / emboss / split / plane)", () => {
    expect(anyToolActive({ holeTool: { phase: "face" } })).toBe(true);
    expect(anyToolActive({ embossTool: { picking: "geometry" } })).toBe(true);
    expect(anyToolActive({ splitTool: {} })).toBe(true);
    expect(anyToolActive({ planePickActive: true })).toBe(true);
  });

  it("is true while picking/editing chamfer, push-pull, extrude, sweep", () => {
    expect(anyToolActive({ chamferSelectMode: "chamfer" })).toBe(true);
    expect(anyToolActive({ pushPullRetargetTarget: { itemId: 1 } })).toBe(true);
    expect(anyToolActive({ extrudeSelectMode: "profile" })).toBe(true);
    expect(anyToolActive({ extrudeRetargetId: 2 })).toBe(true);
    expect(anyToolActive({ sweepSelectMode: { kind: "revolve" } })).toBe(true);
  });

  it("is true for an active sketch drawing tool or placement", () => {
    expect(anyToolActive({ activeSketchTool: "line" })).toBe(true);
    expect(anyToolActive({ sketchPlacementMode: true })).toBe(true);
  });

  it("is true while the Point-to-Point move tool is open", () => {
    expect(anyToolActive({ pointToPointTool: { picking: "A" } })).toBe(true);
  });
});
