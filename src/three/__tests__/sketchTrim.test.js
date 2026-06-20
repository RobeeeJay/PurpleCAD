import { describe, it, expect } from "vitest";
import { computeLineTrim } from "../sketchTrim.js";

// A horizontal line 0..10 on y=0.
const H = { type: "line", x1: 0, y1: 0, x2: 10, y2: 0 };
const vAt = (x) => ({ type: "line", x1: x, y1: -5, x2: x, y2: 5 });

describe("computeLineTrim", () => {
  it("deletes a bare line (no crossings) wherever it's clicked", () => {
    const plan = computeLineTrim([H], 0, 5, 0);
    expect(plan.keepStart).toBeNull();
    expect(plan.keepEnd).toBeNull();
  });

  it("removes the clicked side up to a single crossing (shrink)", () => {
    const shapes = [H, vAt(5)];
    // Click the LEFT half → left part removed, right part survives.
    const left = computeLineTrim(shapes, 0, 2, 0);
    expect(left.keepStart).toBeNull();
    expect(left.keepEnd).toMatchObject({ x1: 5, y1: 0, x2: 10, y2: 0 });
    // Click the RIGHT half → right part removed, left part survives.
    const right = computeLineTrim(shapes, 0, 8, 0);
    expect(right.keepEnd).toBeNull();
    expect(right.keepStart).toMatchObject({ x1: 0, y1: 0, x2: 5, y2: 0 });
  });

  it("splits the line when the clicked span sits between two crossings", () => {
    const shapes = [H, vAt(3), vAt(7)];
    const plan = computeLineTrim(shapes, 0, 5, 0); // middle chunk removed
    expect(plan.keepStart).toMatchObject({ x1: 0, x2: 3 });
    expect(plan.keepEnd).toMatchObject({ x1: 7, x2: 10 });
  });

  it("treats a T-junction (line endpoint touching mid-line) as a crossing", () => {
    // A line whose endpoint lands on H at x=4 — a T, not a full cross.
    const tee = { type: "line", x1: 4, y1: 0, x2: 4, y2: 6 };
    const plan = computeLineTrim([H, tee], 0, 1, 0);
    expect(plan.keepEnd).toMatchObject({ x1: 4, x2: 10 });
  });

  it("treats a standalone point on the line as a crossing", () => {
    const plan = computeLineTrim([H, { type: "point", x: 6, y: 0 }], 0, 9, 0);
    expect(plan.keepStart).toMatchObject({ x1: 0, x2: 6 });
    expect(plan.keepEnd).toBeNull();
  });

  it("returns null when the point isn't on the line", () => {
    expect(computeLineTrim([H], 0, 5, 3)).toBeNull();
    expect(computeLineTrim([H], 0, -2, 0)).toBeNull(); // beyond the endpoint
  });

  it("only trims line shapes", () => {
    expect(
      computeLineTrim([{ type: "circle", cx: 0, cy: 0, r: 5 }], 0, 5, 0),
    ).toBeNull();
  });
});
