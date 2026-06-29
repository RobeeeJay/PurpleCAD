// Regression: the Offset modify tool copies selected lines parallel to
// themselves, links each copy to its source with an `offset` constraint, and
// tags the batch with an offsetGroup so its dimension can be edited as a unit.
// updateSketchOffsetDistance then re-solves, moving only the copies.

import { describe, it, expect, vi } from "vitest";
import { create } from "zustand";

vi.mock("../../store.js", () => ({
  useStore: { getState: () => ({ variables: [] }) },
}));

import { createSketchSlice } from "../sketchSlice.js";
import { buildChamferEdit } from "../../three/sketchGeometry.js";

const makeStore = (items) =>
  create((set) => ({
    items,
    history: [],
    activeHistoryId: null,
    undoStack: [],
    redoStack: [],
    ...createSketchSlice(set),
  }));

const L = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
const C = (cx, cy, r) => ({ type: "circle", cx, cy, r });

// Build a square with one filleted corner and return {shapes, constraints}.
// `cw` reverses the winding so the corner junction flips — the offset of a
// fillet has to stay tangent regardless of which way the loop is wound.
const beveledSquare = (cw) => {
  const shapes = cw
    ? [L(0, 0, 0, 10), L(0, 10, 10, 10), L(10, 10, 10, 0), L(10, 0, 0, 0)]
    : [L(0, 0, 10, 0), L(10, 0, 10, 10), L(10, 10, 0, 10), L(0, 10, 0, 0)];
  const junc = cw
    ? { aIdx: 0, aKey: "start", bIdx: 3, bKey: "end" }
    : { aIdx: 3, aKey: "end", bIdx: 0, bKey: "start" };
  const res = buildChamferEdit(shapes, junc, "bevel", 2, []);
  for (const [idx, sh] of res.updates) shapes[idx] = sh;
  shapes.push(res.newShape);
  return { shapes, constraints: res.newConstraints };
};

// An arc's start/end point in scene coords.
const arcPt = (a, which) => {
  const ang = which === "start" ? a.startAngle : a.endAngle;
  return { x: a.cx + a.r * Math.cos(ang), y: a.cy + a.r * Math.sin(ang) };
};
const legPt = (s, key) =>
  key === "start" ? { x: s.x1, y: s.y1 } : { x: s.x2, y: s.y2 };

// The rectangle the sketch Draw tool builds (top, right, bottom, left, joined
// end->start) with one corner chamfered.  Its chamfer bridge is wound opposite
// the loop, which is what exposed the offset-side bug — so this is the faithful
// reproduction of "square, chamfer top-left, offset".
const chamferedAppRect = (mode) => {
  const shapes = [
    { type: "line", x1: 0, y1: 0, x2: 10, y2: 0 }, // 0 top
    { type: "line", x1: 10, y1: 0, x2: 10, y2: 10 }, // 1 right
    { type: "line", x1: 10, y1: 10, x2: 0, y2: 10 }, // 2 bottom
    { type: "line", x1: 0, y1: 10, x2: 0, y2: 0 }, // 3 left
  ];
  const constraints = [
    {
      type: "coincident",
      shapeAIdx: 0,
      pointA: "end",
      shapeBIdx: 1,
      pointB: "start",
    },
    {
      type: "coincident",
      shapeAIdx: 1,
      pointA: "end",
      shapeBIdx: 2,
      pointB: "start",
    },
    {
      type: "coincident",
      shapeAIdx: 2,
      pointA: "end",
      shapeBIdx: 3,
      pointB: "start",
    },
    {
      type: "coincident",
      shapeAIdx: 3,
      pointA: "end",
      shapeBIdx: 0,
      pointB: "start",
    },
    { type: "horizontal", shapeIdx: 0 },
    { type: "vertical", shapeIdx: 1 },
    { type: "horizontal", shapeIdx: 2 },
    { type: "vertical", shapeIdx: 3 },
  ];
  // Corner where top.start meets left.end (the (0,0) corner).  findJunction
  // can report either leg as "a" depending on which the click snaps to; this
  // (legA = top.start) is the order that wound the bridge against the loop and
  // produced the wedge — so it's the faithful reproduction.
  const res = buildChamferEdit(
    shapes,
    { aIdx: 0, aKey: "start", bIdx: 3, bKey: "end" },
    mode,
    2,
    constraints,
  );
  for (const [idx, sh] of res.updates) shapes[idx] = sh;
  shapes.push(res.newShape);
  const kept = constraints.filter((c) => !res.removeConstraints.includes(c));
  return { shapes, constraints: [...kept, ...res.newConstraints] };
};
const bridgePts = (s) =>
  s.type === "arc"
    ? [arcPt(s, "start"), arcPt(s, "end")]
    : [legPt(s, "start"), legPt(s, "end")];

describe("offsetSketchGeometry + updateSketchOffsetDistance", () => {
  it("offsets a line and groups its constraint, then edits the distance", () => {
    const store = makeStore([
      { id: 1, type: "sketch", shapes: [L(0, 0, 10, 0)], constraints: [] },
    ]);
    // 20mm = 2 scene units to the right-normal (below, +y down convention).
    store.getState().offsetSketchGeometry(1, [0], "20");

    let item = store.getState().items.find((i) => i.id === 1);
    expect(item.shapes).toHaveLength(2);
    const off = item.constraints.find((c) => c.type === "offset");
    expect(off).toBeTruthy();
    expect(off.offsetGroup).toBe(1);
    // The copy sits 2 units off the original.
    const copy = item.shapes[off.shapeIdx];
    expect(Math.abs((copy.y1 + copy.y2) / 2)).toBeCloseTo(2, 2);

    // Edit the group's distance to 50mm = 5 units; original stays put.
    store.getState().updateSketchOffsetDistance(1, off.offsetGroup, null, "50");
    item = store.getState().items.find((i) => i.id === 1);
    expect(item.shapes[0].y1).toBeCloseTo(0);
    expect(item.shapes[0].y2).toBeCloseTo(0);
    const moved = item.shapes[off.shapeIdx];
    expect(Math.abs((moved.y1 + moved.y2) / 2)).toBeCloseTo(5, 2);
  });

  it("offsets a circle into a concentric copy and edits the radius gap", () => {
    const store = makeStore([
      { id: 1, type: "sketch", shapes: [C(0, 0, 3)], constraints: [] },
    ]);
    // +20mm = +2 scene units → a larger concentric circle (r = 3 + 2 = 5).
    store.getState().offsetSketchGeometry(1, [0], "20");

    let item = store.getState().items.find((i) => i.id === 1);
    expect(item.shapes).toHaveLength(2);
    const off = item.constraints.find((c) => c.type === "offset");
    expect(off).toBeTruthy();
    const copy = item.shapes[off.shapeIdx];
    expect(copy.type).toBe("circle");
    expect(copy.cx).toBeCloseTo(0);
    expect(copy.cy).toBeCloseTo(0);
    expect(copy.r).toBeCloseTo(5, 2);
    // No corners to chain — the only new constraint is the offset itself.
    expect(
      item.constraints.filter((c) => c.type === "coincident"),
    ).toHaveLength(0);

    // Editing the gap re-solves the copy's radius; the original is untouched.
    store
      .getState()
      .updateSketchOffsetDistance(1, off.offsetGroup, null, "-10");
    item = store.getState().items.find((i) => i.id === 1);
    expect(item.shapes[0].r).toBeCloseTo(3, 2);
    expect(item.shapes[off.shapeIdx].r).toBeCloseTo(2, 2); // 3 + (-1)
  });

  it("offsets an arc concentrically, keeping its angles, and edits the gap", () => {
    const arc = {
      type: "arc",
      cx: 0,
      cy: 0,
      r: 3,
      startAngle: 0,
      endAngle: Math.PI / 2,
    };
    const store = makeStore([
      { id: 1, type: "sketch", shapes: [arc], constraints: [] },
    ]);
    store.getState().offsetSketchGeometry(1, [0], "20"); // +2 units

    let item = store.getState().items.find((i) => i.id === 1);
    const off = item.constraints.find((c) => c.type === "offset");
    const copy = item.shapes[off.shapeIdx];
    expect(copy.type).toBe("arc");
    expect(copy.cx).toBeCloseTo(0);
    expect(copy.cy).toBeCloseTo(0);
    expect(copy.r).toBeCloseTo(5, 2);
    expect(copy.startAngle).toBeCloseTo(0);
    expect(copy.endAngle).toBeCloseTo(Math.PI / 2);

    store.getState().updateSketchOffsetDistance(1, off.offsetGroup, null, "10");
    item = store.getState().items.find((i) => i.id === 1);
    expect(item.shapes[0].r).toBeCloseTo(3, 2); // original untouched
    expect(item.shapes[off.shapeIdx].r).toBeCloseTo(4, 2); // 3 + 1
  });

  it("offsets an ellipse by growing both semi-axes", () => {
    const ell = { type: "ellipse", cx: 1, cy: 2, rx: 4, ry: 2, rotation: 0.3 };
    const store = makeStore([
      { id: 1, type: "sketch", shapes: [ell], constraints: [] },
    ]);
    store.getState().offsetSketchGeometry(1, [0], "20"); // +2 units

    let item = store.getState().items.find((i) => i.id === 1);
    const off = item.constraints.find((c) => c.type === "offset");
    const copy = item.shapes[off.shapeIdx];
    expect(copy.type).toBe("ellipse");
    expect(copy.cx).toBeCloseTo(1);
    expect(copy.cy).toBeCloseTo(2);
    expect(copy.rx).toBeCloseTo(6, 2);
    expect(copy.ry).toBeCloseTo(4, 2);
    expect(copy.rotation).toBeCloseTo(0.3);
  });

  // Regression: a fillet (bevel) corner offset as part of a closed profile must
  // become a CONCENTRIC arc whose radius follows the offset side (grows moving
  // outward, shrinks moving inward) so it stays joined to its offset legs.  The
  // bug: offsetShapeGeometry always did r+d, so on a reversed-wound loop the arc
  // grew while the legs moved inward, tearing it off the legs — and the distance
  // edit then failed to converge, leaving the fillet stuck at the seed value.
  for (const cw of [false, true]) {
    it(`offsets a filleted corner concentric to its legs (${cw ? "CW" : "CCW"} loop)`, () => {
      const { shapes, constraints } = beveledSquare(cw);
      const arc0 = shapes.find((s) => s.kind === "bevel");
      const cx = arc0.cx,
        cy = arc0.cy;
      expect(arc0.r).toBeCloseTo(2, 6);

      const store = makeStore([{ id: 1, type: "sketch", shapes, constraints }]);
      const offsetAll = (mm) =>
        store.getState().offsetSketchGeometry(
          1,
          store
            .getState()
            .items.find((i) => i.id === 1)
            .shapes.map((_, i) => i),
          mm,
        );

      // The offset side is each leg's own normal: +5mm moves the profile inward
      // on a CW loop, outward on a CCW one — yet the fillet must stay attached.
      offsetAll("5");
      let item = store.getState().items.find((i) => i.id === 1);
      const off = item.constraints.find(
        (c) => c.type === "offset" && shapes[c.origIdx]?.kind === "bevel",
      );
      const checkConnected = (it) => {
        const arc = it.shapes[off.shapeIdx];
        expect(arc.type).toBe("arc");
        // Stays concentric with the original fillet centre.
        expect(arc.cx).toBeCloseTo(cx, 3);
        expect(arc.cy).toBeCloseTo(cy, 3);
        // Each endpoint sits on some offset leg's endpoint (still joined).
        const legEnds = it.shapes
          .filter((s, i) => s.type === "line" && i >= shapes.length)
          .flatMap((s) => [legPt(s, "start"), legPt(s, "end")]);
        for (const p of [arcPt(arc, "start"), arcPt(arc, "end")]) {
          const near = legEnds.some(
            (q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-3,
          );
          expect(near).toBe(true);
        }
        return arc;
      };
      // CW loop offsets inward here (radius shrinks to 1.5); CCW outward (2.5).
      const arc1 = checkConnected(item);
      expect(arc1.r).toBeCloseTo(cw ? 1.5 : 2.5, 2);

      // The distance edit (the real second step of the tool) must re-size the
      // fillet, not stall — bump to 8mm and re-check the radius and the joins.
      store
        .getState()
        .updateSketchOffsetDistance(1, off.offsetGroup, null, "8");
      item = store.getState().items.find((i) => i.id === 1);
      const arc2 = checkConnected(item);
      expect(arc2.r).toBeCloseTo(cw ? 1.2 : 2.8, 2);
    });
  }

  // Regression for the reported bug: square, chamfer/bevel the top-left corner
  // with the modify tool, offset the result.  The Draw-tool rectangle winds its
  // chamfer bridge opposite the loop, so the bridge used to offset to the WRONG
  // side and stretch into a big wedge off the corner.  The offset bridge must
  // stay a sane parallel offset: connected to its legs and roughly the size of
  // the original (a 2-setback 90deg chamfer spans 2*sqrt2 ~= 2.83; the wedge bug
  // pushed it past 5).
  for (const mode of ["chamfer", "bevel"]) {
    it(`offsets the app rectangle's ${mode} corner without a wedge`, () => {
      const { shapes, constraints } = chamferedAppRect(mode);
      const store = makeStore([{ id: 1, type: "sketch", shapes, constraints }]);
      const idxs = shapes.map((_, i) => i);
      const bridgeOf = (it) =>
        it.shapes[
          it.constraints.find(
            (c) =>
              c.type === "offset" &&
              (shapes[c.origIdx]?.kind === "chamfer" ||
                shapes[c.origIdx]?.kind === "bevel"),
          ).shapeIdx
        ];

      for (const dist of ["5", "-5"]) {
        const s2 = makeStore([
          {
            id: 1,
            type: "sketch",
            shapes: shapes.map((s) => ({ ...s })),
            constraints: constraints.map((c) => ({ ...c })),
          },
        ]);
        s2.getState().offsetSketchGeometry(1, idxs, dist);
        const item = s2.getState().items.find((i) => i.id === 1);
        const bridge = bridgeOf(item);
        const [p, q] = bridgePts(bridge);
        const span = Math.hypot(p.x - q.x, p.y - q.y);
        // Outward (+) grows the corner a little, inward (-) shrinks it; either
        // way it stays near 2.83, never the >5 wedge the bug produced.
        expect(span).toBeGreaterThan(1.5);
        expect(span).toBeLessThan(4);
        // Both bridge ends meet an offset leg (closed loop, no escaping wedge).
        const legEnds = item.shapes
          .filter((s, i) => s.type === "line" && i >= shapes.length)
          .flatMap((s) => [legPt(s, "start"), legPt(s, "end")]);
        for (const e of [p, q]) {
          expect(
            legEnds.some((g) => Math.hypot(e.x - g.x, e.y - g.y) < 1e-3),
          ).toBe(true);
        }
      }
    });
  }

  // Regression for the exact reported case (a clockwise-wound square chamfered
  // at the top-left).  The tool winds the chamfer bridge against the loop, so a
  // plain offset threw it to the wrong side and it ballooned into a multi-unit
  // wedge outside the square.  Correcting the offset side makes the tool chamfer
  // behave exactly like a hand-drawn one: a smaller chamfer going inward, a
  // larger one going outward — always connected, never a wedge.
  it("offsets a CW square's top-left chamfer like a hand-drawn one", () => {
    const shapes = [
      { type: "line", x1: -5.75, y1: 4.5, x2: 7.5, y2: 4.5 },
      { type: "line", x1: 7.5, y1: 4.5, x2: 7.5, y2: -3.5 },
      { type: "line", x1: 7.5, y1: -3.5, x2: -6, y2: -3.5 },
      { type: "line", x1: -6, y1: -3.5, x2: -6, y2: 4.25 },
      {
        type: "line",
        x1: -5.75,
        y1: 4.5,
        x2: -6,
        y2: 4.25,
        kind: "chamfer",
        chamferData: {
          aIdx: 0,
          aKey: "start",
          bIdx: 3,
          bKey: "end",
          dist: 0.25,
        },
      },
    ];
    const constraints = [
      {
        type: "coincident",
        shapeAIdx: 0,
        pointA: "end",
        shapeBIdx: 1,
        pointB: "start",
      },
      {
        type: "coincident",
        shapeAIdx: 1,
        pointA: "end",
        shapeBIdx: 2,
        pointB: "start",
      },
      {
        type: "coincident",
        shapeAIdx: 2,
        pointA: "end",
        shapeBIdx: 3,
        pointB: "start",
      },
      { type: "horizontal", shapeIdx: 0 },
      { type: "vertical", shapeIdx: 1 },
      { type: "horizontal", shapeIdx: 2 },
      { type: "vertical", shapeIdx: 3 },
      {
        type: "coincident",
        shapeAIdx: 4,
        pointA: "start",
        shapeBIdx: 0,
        pointB: "start",
      },
      {
        type: "coincident",
        shapeAIdx: 4,
        pointA: "end",
        shapeBIdx: 3,
        pointB: "end",
      },
      { type: "lineAngle", shapeAIdx: 0, shapeBIdx: 3, angle: 90 },
    ];
    const closedLoop = (item) => {
      const ns = item.shapes.slice(5);
      for (const s of ns) {
        for (const a of [legPt(s, "start"), legPt(s, "end")]) {
          const near = ns.some(
            (t) =>
              t !== s &&
              [legPt(t, "start"), legPt(t, "end")].some(
                (b) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-3,
              ),
          );
          expect(near).toBe(true);
        }
      }
    };
    const lastSpan = (item) => {
      const ch = item.shapes[item.shapes.length - 1];
      return Math.hypot(ch.x1 - ch.x2, ch.y1 - ch.y2);
    };

    // 2mm inward shrinks the 0.354-long chamfer; 5mm outward grows it.  Each
    // stays a CLOSED loop with a sane chamfer — never the multi-unit wedge.
    for (const [d, lo, hi] of [
      ["2", 0.05, 0.354],
      ["-5", 0.354, 1],
    ]) {
      const store = makeStore([
        {
          id: 1,
          type: "sketch",
          shapes: shapes.map((s) => ({ ...s })),
          constraints: constraints.map((c) => ({ ...c })),
        },
      ]);
      store.getState().offsetSketchGeometry(1, [0, 1, 2, 3, 4], d);
      const item = store.getState().items.find((i) => i.id === 1);
      closedLoop(item);
      const span = lastSpan(item);
      expect(span).toBeGreaterThanOrEqual(lo);
      expect(span).toBeLessThan(hi);
    }

    // The two-step tool flow: a 5mm seed, then the distance editor.  Editing the
    // value must actually move the offset (it was getting pinned before) and stay
    // a closed loop.  The top edge (copy 5) sits `d` below its 4.5 original.
    const store = makeStore([
      {
        id: 1,
        type: "sketch",
        shapes: shapes.map((s) => ({ ...s })),
        constraints: constraints.map((c) => ({ ...c })),
      },
    ]);
    store.getState().offsetSketchGeometry(1, [0, 1, 2, 3, 4], "5");
    const off = store
      .getState()
      .items.find((i) => i.id === 1)
      .constraints.find((c) => c.type === "offset");
    for (const [mm, expY] of [
      ["1", 4.4],
      ["3", 4.2],
    ]) {
      store.getState().updateSketchOffsetDistance(1, off.offsetGroup, null, mm);
      const item = store.getState().items.find((i) => i.id === 1);
      expect(item.shapes[5].y1).toBeCloseTo(expY, 2); // value respected
      closedLoop(item);
      expect(lastSpan(item)).toBeGreaterThan(0.05); // a real chamfer, not gone
    }
  });

  it("offsets a bezier and recomputes its geometry when the gap changes", () => {
    // A straight horizontal bezier so the offset is a simple vertical shift.
    const bez = {
      type: "bezier",
      p0: { x: 0, y: 0 },
      p1: { x: 3, y: 0 },
      p2: { x: 6, y: 0 },
      p3: { x: 9, y: 0 },
    };
    const store = makeStore([
      { id: 1, type: "sketch", shapes: [bez], constraints: [] },
    ]);
    store.getState().offsetSketchGeometry(1, [0], "20"); // +2 units

    let item = store.getState().items.find((i) => i.id === 1);
    expect(item.shapes).toHaveLength(2);
    const off = item.constraints.find((c) => c.type === "offset");
    const copy = item.shapes[off.shapeIdx];
    expect(copy.type).toBe("bezier");
    // Right normal of a left-to-right curve points -y (same convention as the
    // line offset); all control points shift by the full offset.
    [copy.p0, copy.p1, copy.p2, copy.p3].forEach((p) =>
      expect(p.y).toBeCloseTo(-2, 2),
    );

    // Beziers aren't solver-linked — the distance edit recomputes geometry.
    store.getState().updateSketchOffsetDistance(1, off.offsetGroup, null, "50");
    item = store.getState().items.find((i) => i.id === 1);
    const moved = item.shapes[off.shapeIdx];
    [moved.p0, moved.p1, moved.p2, moved.p3].forEach((p) =>
      expect(p.y).toBeCloseTo(-5, 2),
    );
    // Original bezier stays put.
    expect(item.shapes[0].p0.y).toBeCloseTo(0);
  });
});
