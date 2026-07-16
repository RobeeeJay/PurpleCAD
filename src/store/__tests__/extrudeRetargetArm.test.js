// Regression: arming an extrude retarget must survive entering profile mode.
// setExtrudeSelectMode spreads TOOL_RESET_PATCH when freshly entering extrude,
// which nulls extrudeRetargetId/Group — so the Timeline button must switch the
// mode BEFORE setting the retarget target, or confirm builds a NEW extrude
// instead of editing the existing one.

import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { createUiSlice, uiInitial } from "../uiSlice.js";

const makeStore = () =>
  create((set) => ({ ...uiInitial, ...createUiSlice(set) }));

describe("extrude retarget arming order", () => {
  it("entering profile mode AFTER arming wipes the retarget id (the bug)", () => {
    const s = makeStore();
    s.getState().setExtrudeRetargetId(2);
    s.getState().setExtrudeSelectMode("profile"); // fresh enter → TOOL_RESET_PATCH
    expect(s.getState().extrudeRetargetId).toBe(null);
  });

  it("entering profile mode FIRST keeps the retarget id (the fix)", () => {
    const s = makeStore();
    s.getState().setExtrudeSelectMode("profile");
    s.getState().setExtrudeRetargetId(2);
    expect(s.getState().extrudeSelectMode).toBe("profile");
    expect(s.getState().extrudeRetargetId).toBe(2);
  });

  it("keeps a group retarget too when armed after the mode switch", () => {
    const s = makeStore();
    s.getState().setExtrudeSelectMode("profile");
    s.getState().setExtrudeRetargetGroup([2, 3]);
    s.getState().setExtrudeRetargetId(2);
    expect(s.getState().extrudeRetargetGroup).toEqual([2, 3]);
    expect(s.getState().extrudeRetargetId).toBe(2);
  });
});
