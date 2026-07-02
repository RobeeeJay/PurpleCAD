// Picking a curved surface for the Emboss tool nudges the still-default "center"
// projection to "conform" — center is degenerate on a sphere/cylinder.

import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { createUiSlice, uiInitial } from "../uiSlice.js";

const makeStore = () =>
  create((set) => ({ ...uiInitial, ...createUiSlice(set) }));

describe("emboss projection auto-conform", () => {
  it("switches center → conform when a curved face set is picked", () => {
    const s = makeStore();
    s.getState().startEmbossTool();
    expect(s.getState().embossTool.params.projection).toBe("center");
    s.getState().setEmbossFaceSelection({
      itemId: 1,
      face: { nx: 0, ny: 0, nz: 1, cx: 0, cy: 0, cz: 1.5 },
      faceSet: { sphere: { cx: 0, cy: 0, cz: 0, radius: 1.5 } },
      valid: true,
      keepPicking: false,
    });
    expect(s.getState().embossTool.params.projection).toBe("conform");
  });

  it("leaves center for a flat face (no faceSet)", () => {
    const s = makeStore();
    s.getState().startEmbossTool();
    s.getState().setEmbossFaceSelection({
      itemId: 1,
      face: { nx: 0, ny: 0, nz: 1, cx: 0, cy: 0, cz: 1 },
      faceSet: null,
      valid: true,
      keepPicking: false,
    });
    expect(s.getState().embossTool.params.projection).toBe("center");
  });

  it("setToolError sets the line and starting a tool clears it", () => {
    const s = makeStore();
    s.getState().setToolError("Emboss failed — too many curved faces.");
    expect(s.getState().toolError).toMatch(/too many curved faces/);
    s.getState().setToolError(null);
    expect(s.getState().toolError).toBe(null);
    // A stale error from a prior op is cleared when a fresh tool opens.
    s.getState().setToolError("Draft failed.");
    s.getState().startDraftTool();
    expect(s.getState().toolError).toBe(null);
    s.getState().setToolError("Emboss failed.");
    s.getState().startEmbossTool();
    expect(s.getState().toolError).toBe(null);
  });

  it("does not override a manual conform choice on re-pick", () => {
    const s = makeStore();
    s.getState().startEmbossTool();
    s.getState().updateEmbossParams({ projection: "conform" });
    s.getState().setEmbossFaceSelection({
      itemId: 1,
      face: { nx: 0, ny: 0, nz: 1, cx: 0, cy: 0, cz: 1 },
      faceSet: null,
      valid: true,
      keepPicking: false,
    });
    expect(s.getState().embossTool.params.projection).toBe("conform");
  });
});
