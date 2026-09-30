// Shift-drag in a sketch locks the drag to one axis: the larger component of
// the drag so far, measured from where it started.
import { describe, it, expect } from "vitest";
import { lockToAxis } from "../sketchGeometry.js";

const start = { x: 2, y: 3 };

describe("lockToAxis", () => {
  it("drops the sideways part when the drag has gone further up", () => {
    // 10 mm right, then 11 mm up: locked to 11 mm up, no right offset.
    expect(lockToAxis(start, { x: 3, y: 4.1 })).toEqual({ x: 2, y: 4.1 });
  });

  it("drops the vertical part when the drag has gone further across", () => {
    expect(lockToAxis(start, { x: -4, y: 5 })).toEqual({ x: -4, y: 3 });
  });

  it("keeps the horizontal on a tie", () => {
    expect(lockToAxis(start, { x: 3, y: 4 })).toEqual({ x: 3, y: 3 });
  });

  it("leaves a drag already along an axis where it is", () => {
    expect(lockToAxis(start, { x: 2, y: -1 })).toEqual({ x: 2, y: -1 });
  });
});
