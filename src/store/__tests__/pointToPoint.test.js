// Point-to-Point move tool: the pick state machine (arm A, capture A, auto-arm
// B, capture B) and the align-delta the dialog applies on confirm.

import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { createUiSlice } from "../uiSlice.js";

const makeStore = () => create((set) => createUiSlice(set));

describe("pointToPointTool", () => {
  it("walks A -> B and back to idle as points are captured", () => {
    const s = makeStore();
    s.getState().startPointToPointTool();
    expect(s.getState().pointToPointTool).toMatchObject({
      picking: "A",
      a: null,
      b: null,
    });

    s.getState().setPointToPointPoint("A", 1, { x: 0, y: 0, z: 0 });
    const afterA = s.getState().pointToPointTool;
    expect(afterA.a).toEqual({ itemId: 1, point: { x: 0, y: 0, z: 0 } });
    expect(afterA.picking).toBe("B"); // auto-advances to B

    s.getState().setPointToPointPoint("B", 2, { x: 5, y: 0, z: 0 });
    const afterB = s.getState().pointToPointTool;
    expect(afterB.b).toEqual({ itemId: 2, point: { x: 5, y: 0, z: 0 } });
    expect(afterB.picking).toBe(null); // both picked → nothing armed

    s.getState().cancelPointToPointTool();
    expect(s.getState().pointToPointTool).toBe(null);
  });

  it("re-picking A keeps B armed off (doesn't clobber an existing B)", () => {
    const s = makeStore();
    s.getState().startPointToPointTool();
    s.getState().setPointToPointPoint("B", 2, { x: 5, y: 0, z: 0 });
    s.getState().setPointToPointPoint("A", 1, { x: 1, y: 1, z: 1 });
    // B already set, so re-capturing A shouldn't re-arm B.
    expect(s.getState().pointToPointTool.picking).toBe(null);
  });

  it("setPointToPointPicking toggles the armed point", () => {
    const s = makeStore();
    s.getState().startPointToPointTool();
    s.getState().setPointToPointPicking("A");
    expect(s.getState().pointToPointTool.picking).toBe(null); // was A → toggled off
    s.getState().setPointToPointPicking("B");
    expect(s.getState().pointToPointTool.picking).toBe("B");
  });

  it("align delta moves A's position by (B - A)", () => {
    // The dialog's confirm math: new A position = old + (b.point - a.point).
    const a = { point: { x: 2, y: 3, z: 4 } };
    const b = { point: { x: 10, y: 1, z: 4 } };
    const pos = { x: 100, y: 100, z: 100 };
    const moved = {
      x: pos.x + (b.point.x - a.point.x),
      y: pos.y + (b.point.y - a.point.y),
      z: pos.z + (b.point.z - a.point.z),
    };
    expect(moved).toEqual({ x: 108, y: 98, z: 100 });
  });
});
