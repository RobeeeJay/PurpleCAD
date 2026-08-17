// The scene inspector's data collection is pure, so what it reports is pinned
// here rather than only being visible in the dialog.  Two things matter most:
// axis-labelled values must go through the display frame (a debug view that
// mislabels axes is worse than none), and a sketch whose constraints name the
// wrong shape must be flagged — that's the corruption class a projection refit
// used to introduce.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  buildInspectorRows,
  vectorDetail,
  sketchShapeRows,
  sketchConstraintRows,
} from "../sceneInspector.js";

describe("vectorDetail", () => {
  it("maps to the user's Z-up frame (user X,Y,Z = internal x,-z,y)", () => {
    const d = vectorDetail({ x: 1, y: 2, z: 3 });
    expect(d.display).toEqual([
      { label: "X", value: 1 },
      { label: "Y", value: -3 },
      { label: "Z", value: 2 },
    ]);
  });

  it("also reports the raw internal components (a debug view needs both)", () => {
    expect(vectorDetail({ x: 1, y: 2, z: 3 }).internal).toEqual({
      x: 1,
      y: 2,
      z: 3,
    });
  });

  it("never sign-flips an unsigned quantity like scale", () => {
    const d = vectorDetail({ x: 1, y: 2, z: 3 }, { signed: false });
    expect(d.display.map((a) => a.value)).toEqual([1, 3, 2]);
  });
});

describe("sketchShapeRows", () => {
  const item = {
    shapes: [
      { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
      { type: "line", x1: 0, y1: 0, x2: 0, y2: 4, projection: { key: "k" } },
      { type: "circle", cx: 1, cy: 2, r: 0.5 },
    ],
  };
  it("classifies line orientation and reports length in mm", () => {
    const rows = sketchShapeRows(item);
    expect(rows[0].geometry.orientation).toBe("horizontal");
    expect(rows[0].geometry.lengthMm).toBe(40);
    expect(rows[1].geometry.orientation).toBe("vertical");
  });
  it("flags projected geometry", () => {
    expect(sketchShapeRows(item)[1].flags).toContain("projected:k");
  });
  it("reports a circle's radius in mm", () => {
    expect(sketchShapeRows(item)[2].geometry.radiusMm).toBe(5);
  });
});

describe("sketchConstraintRows", () => {
  it("flags a constraint bound to geometry that contradicts it", () => {
    const item = {
      // The line is VERTICAL, so a "horizontal" on it is mis-bound.
      shapes: [{ type: "line", x1: 0, y1: 0, x2: 0, y2: 4 }],
      constraints: [{ type: "horizontal", shapeIdx: 0 }],
    };
    expect(sketchConstraintRows(item)[0].mismatch).toBe("line is vertical");
  });

  it("flags a constraint naming a shape that doesn't exist", () => {
    const item = {
      shapes: [{ type: "line", x1: 0, y1: 0, x2: 4, y2: 0 }],
      constraints: [{ type: "horizontal", shapeIdx: 7 }],
    };
    expect(sketchConstraintRows(item)[0].dangling).toHaveLength(1);
  });

  it("passes a correctly-bound constraint clean", () => {
    const item = {
      shapes: [{ type: "line", x1: 0, y1: 0, x2: 4, y2: 0 }],
      constraints: [{ type: "horizontal", shapeIdx: 0 }],
    };
    const [c] = sketchConstraintRows(item);
    expect(c.mismatch).toBeNull();
    expect(c.dangling).toBeNull();
  });

  it("tolerates solver float residue on a horizontal line", () => {
    // Real case: a converged horizontal line off by 2.5e-6 units (0.0001°).
    // An exact-zero test called it "angled" and cried corruption.
    const item = {
      shapes: [
        {
          type: "line",
          x1: -2.5599,
          y1: -186.3757037,
          x2: -1.5599,
          y2: -186.3757063,
        },
      ],
      constraints: [{ type: "horizontal", shapeIdx: 0 }],
    };
    expect(sketchShapeRows(item)[0].geometry.orientation).toBe("horizontal");
    expect(sketchConstraintRows(item)[0].mismatch).toBeNull();
  });

  it("does not cry corruption over a merely angled line", () => {
    // Under-constrained / mid-draw geometry is normal, not a mis-binding.
    const item = {
      shapes: [{ type: "line", x1: 0, y1: 0, x2: 4, y2: 1 }],
      constraints: [{ type: "horizontal", shapeIdx: 0 }],
    };
    expect(sketchConstraintRows(item)[0].mismatch).toBeNull();
  });

  it("still flags an H constraint on a definitively VERTICAL line", () => {
    const item = {
      shapes: [{ type: "line", x1: 0, y1: 0, x2: 0, y2: 4 }],
      constraints: [{ type: "horizontal", shapeIdx: 0 }],
    };
    expect(sketchConstraintRows(item)[0].mismatch).toBe("line is vertical");
  });

  it("checks a numeric-STRING distance (how they're normally authored)", () => {
    const item = {
      shapes: [{ type: "line", x1: 0, y1: 0, x2: 3, y2: 0 }], // 30 mm
      constraints: [
        {
          type: "distance",
          shapeAIdx: 0,
          pointA: "start",
          shapeBIdx: 0,
          pointB: "end",
          distance: "145",
        },
      ],
    };
    expect(sketchConstraintRows(item)[0].mismatch).toBe("measures 30.0mm");
  });

  it("uses a relative tolerance so a large dimension doesn't trip on rounding", () => {
    const item = {
      shapes: [{ type: "line", x1: 0, y1: 0, x2: 195.5, y2: 0 }], // 1955 mm
      constraints: [
        {
          type: "distance",
          shapeAIdx: 0,
          pointA: "start",
          shapeBIdx: 0,
          pointB: "end",
          distance: "1955",
        },
      ],
    };
    expect(sketchConstraintRows(item)[0].mismatch).toBeNull();
  });
});

describe("buildInspectorRows", () => {
  it("reports identity, transform and the regenerator recipe", () => {
    const rows = buildInspectorRows([
      {
        id: 4,
        name: "Cut 4",
        type: "csg",
        position: { x: 1, y: 2, z: 3 },
        rotation: { x: Math.PI / 2, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 2 },
        regenerator: { kind: "extrudeCut", inputIds: [2], regeneratedAt: 0.1 },
      },
    ]);
    const r = rows[0];
    expect(r.id).toBe(4);
    expect(r.type).toBe("csg");
    expect(r.transform.rotationDeg.internal.x).toBe(90); // radians -> degrees
    expect(r.recipe).toMatchObject({ kind: "extrudeCut", inputIds: [2] });
  });

  it("merges live mesh facts the store can't know", () => {
    const rows = buildInspectorRows([{ id: 1, type: "cube" }], () => ({
      points: 24,
      faces: 12,
      sizeMm: { x: 10, y: 10, z: 10 },
      worldPosition: { x: 0, y: 1, z: 0 },
    }));
    expect(rows[0].mesh.vertices).toBe(24);
    expect(rows[0].mesh.triangles).toBe(12);
    expect(rows[0].mesh.worldPosition.display[2].value).toBe(1); // user Z = internal y
  });

  it("surfaces a real document's mis-bound sketch constraints", () => {
    // circle-sketch-move.pcad is the reported corruption: a projection refit
    // renumbered Sketch 3's shapes without remapping its constraints.
    const path = "test-files/circle-sketch-move.pcad";
    if (!fs.existsSync(path)) return; // fixture is optional in the repo
    const doc = JSON.parse(fs.readFileSync(path, "utf8"));
    const items = doc.history
      .filter((h) => h.instruction?.type === "create")
      .map((h) => h.instruction.item);
    const sketch3 = buildInspectorRows(items).find((r) => r.id === 3);
    expect(sketch3.warnings.join(" ")).toMatch(/constraint/);
    expect(
      sketch3.sketch.constraints.filter((c) => c.mismatch || c.dangling).length,
    ).toBeGreaterThan(0);
  });
});
