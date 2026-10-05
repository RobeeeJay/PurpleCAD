// The Measure tool, through its real overlay: each case seeds the picks the way
// a click would and then reads the text the user actually sees in
// `.measure-readout`.
//
// Two code paths sit behind that readout and both are covered. With a sketch
// selected it measures the SKETCH selection (length, radius, area, gap).
// Otherwise it measures the 3D picks -- vertex / edge / face -- where two picks
// give the distance between their CENTRES: a vertex is itself, a line is the
// point half way along it, a face is the middle of its extent. Where in a face
// you happened to click must not change the number.
//
// Entity points are [x,y,z] arrays in world scene units; the readout is mm
// (MM_PER_UNIT = 10), so a 2-unit edge reads "20.00 mm".
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

let app;
let page;

const MM = 10;
const SKETCH_ID = 900;

const startMeasure = () =>
  page.evaluate(() => {
    const s = window.__store.getState();
    s.selectItem(null); // no sketch selected -> the 3D pick path
    s.startMeasureTool();
  });

const pick = (...entities) =>
  page.evaluate((es) => {
    const s = window.__store.getState();
    s.clearMeasurePicks();
    for (const e of es) s.addMeasurePick(e);
  }, entities);

// Select shapes of the sketch -> the sketch path.
const selectShapes = (...idxs) =>
  page.evaluate((ii) => {
    const s = window.__store.getState();
    s.clearMeasurePicks();
    s.setSelectedSketchElement(null);
    s.setSketchMultiSelectedIndices(ii);
  }, idxs);

const readout = () => page.locator(".measure-readout");

// The overlay renders on the frame after a store write.
const readText = async () => {
  await page.waitForTimeout(250);
  return (await readout().innerText()).replace(/\s+/g, " ").trim();
};

const num = (text, label) =>
  Number(text.match(new RegExp(`${label}\\s+([\\d.]+) mm`))[1]);

test.describe.serial("measure tool", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("the overlay opens and prompts for a pick", async () => {
    await startMeasure();
    await expect(readout()).toBeVisible();
    expect(await readText()).toBe("Measure");
  });

  test("a straight edge reports its length", async () => {
    // 3-4-5: a length that cannot come out right by accident.
    await pick({ kind: "segment", a: [0, 0, 0], b: [3, 4, 0] });
    expect(await readText()).toBe("Length 50.00 mm");
  });

  test("a curved edge reports its arc length, not its chord", async () => {
    const r = 3;
    const N = 64;
    const pts = [];
    for (let i = 0; i <= N; i++) {
      const a = (Math.PI / 2) * (i / N);
      pts.push([Math.cos(a) * r, Math.sin(a) * r, 0]);
    }
    await pick({ kind: "polyline", pts, closed: false });
    const value = num(await readText(), "Length");

    const arc = (Math.PI / 2) * r * MM; // 47.12 mm
    const chord = Math.SQRT2 * r * MM; // 42.43 mm -- what a straight-line
    // reading would give, which is the thing this test exists to rule out.
    expect(value).toBeCloseTo(arc, 1);
    expect(value).toBeGreaterThan(chord + 4);
  });

  test("a closed picked loop includes its closing segment", async () => {
    const sq = [
      [0, 0, 0],
      [2, 0, 0],
      [2, 0, 2],
      [0, 0, 2],
    ];
    await pick({ kind: "polyline", pts: sq, closed: false });
    expect(num(await readText(), "Length")).toBeCloseTo(6 * MM, 1);
    await pick({ kind: "polyline", pts: sq, closed: true });
    expect(num(await readText(), "Length")).toBeCloseTo(8 * MM, 1);
  });

  test("a face reports its own two side lengths, not a bounding box", async () => {
    // 4 x 2 units, deliberately NOT axis-aligned: faceDimensions runs a PCA, so
    // a rotated rectangle must still report its own sides.
    const c = Math.SQRT1_2;
    await pick({
      kind: "face",
      normal: [0, 1, 0],
      pts: [
        [0, 0, 0],
        [4 * c, 0, 4 * c],
        [4 * c - 2 * c, 0, 4 * c + 2 * c],
        [-2 * c, 0, 2 * c],
      ],
    });
    const text = await readText();
    const [, w, h] = text.match(/Face\s+([\d.]+) mm × ([\d.]+) mm/);
    expect(Number(w)).toBeCloseTo(4 * MM, 1);
    expect(Number(h)).toBeCloseTo(2 * MM, 1);
  });

  test("two vertices report the distance between them", async () => {
    // Picked as a click picks a vertex: the point, and where it was clicked
    // (`at`), which the markers are drawn from.
    await pick(
      { kind: "point", p: [0, 0, 0], at: [0, 0, 0], pick: "vertex" },
      { kind: "point", p: [3, 4, 0], at: [3, 4, 0], pick: "vertex" },
    );
    expect(await readText()).toBe("Distance 50.00 mm");
    // Each pick is marked by a dot a few pixels across at any zoom -- it was a
    // sphere sized off the part, which hid the point and grew as you zoomed.
    const markers = () =>
      page.evaluate(() =>
        window.__store.getState()._cameraControls.getMeasureMarkers(),
      );
    await expect
      .poll(
        async () => (await markers()).filter((m) => m.type === "Points").length,
      )
      .toBe(2);
    const drawn = await markers();
    expect(
      drawn.some((m) => m.type === "Mesh"),
      JSON.stringify(drawn),
    ).toBe(false);
    for (const d of drawn.filter((m) => m.type === "Points")) {
      expect(d.sizeAttenuation).toBe(false);
      expect(d.size).toBeLessThanOrEqual(8);
    }
  });

  test("two edges measure mid-point to mid-point", async () => {
    // Parallel but offset along their own direction: the mid-points are 2 units
    // apart in x as well as 2.5 across, which the nearest-approach reading
    // (a flat 25mm) would have hidden.
    await pick(
      { kind: "segment", a: [0, 0, 0], b: [5, 0, 0] }, // mid (2.5,0,0)
      { kind: "segment", a: [2, 2.5, 0], b: [7, 2.5, 0] }, // mid (4.5,2.5,0)
    );
    expect(num(await readText(), "Distance")).toBeCloseTo(
      Math.hypot(2, 2.5) * MM,
      1,
    );
  });

  test("two faces measure centre to centre", async () => {
    const face = (y) => ({
      kind: "face",
      normal: [0, 1, 0],
      pts: [
        [0, y, 0],
        [2, y, 0],
        [2, y, 2],
        [0, y, 2],
      ],
    });
    await pick(face(0), face(3));
    expect(await readText()).toBe("Distance 30.00 mm");
  });

  test("a vertex over a face measures straight down to the face's centre", async () => {
    await pick(
      { kind: "point", p: [1, 4, 1] },
      {
        kind: "face",
        normal: [0, 1, 0],
        pts: [
          [0, 0, 0],
          [2, 0, 0],
          [2, 0, 2],
          [0, 0, 2],
        ],
        at: [1.9, 0, 1.9], // clicked near a corner: must not matter
      },
    );
    // The face's centre is (1,0,1), directly below the vertex, so this is the
    // perpendicular 40mm -- not the 41.23mm to the nearest edge that the old
    // nearest-approach reading gave.
    expect(num(await readText(), "Distance")).toBeCloseTo(4 * MM, 1);
  });

  test("Escape clears the picks first, and only then closes the tool", async () => {
    await pick({ kind: "point", p: [0, 0, 0] });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    expect(
      await page.evaluate(
        () => window.__store.getState().measureTool?.picks.length ?? null,
      ),
    ).toBe(0);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    expect(
      await page.evaluate(() => !!window.__store.getState().measureTool),
    ).toBe(false);
  });

  // ---- the sketch-selection path -------------------------------------------

  test("a sketch is selected and the tool switches to measuring its shapes", async () => {
    await page.evaluate((id) => {
      const s = window.__store.getState();
      // A 4x3 rectangle drawn as four separate lines (0-3), a circle (4), a
      // quarter arc (5), two parallel lines 2.5 apart (6,7), two lines joined
      // end to end (8,9), and 24 lines round a circle of radius 1.5 (10-33).
      // No constraints: these are measured as authored.
      const shapes = [
        { type: "line", x1: 0, y1: 0, x2: 4, y2: 0 },
        { type: "line", x1: 4, y1: 0, x2: 4, y2: 3 },
        { type: "line", x1: 4, y1: 3, x2: 0, y2: 3 },
        { type: "line", x1: 0, y1: 3, x2: 0, y2: 0 },
        { type: "circle", cx: 10, cy: 0, r: 2 },
        {
          type: "arc",
          cx: 10,
          cy: 8,
          r: 3,
          startAngle: 0,
          endAngle: Math.PI / 2,
        },
        { type: "line", x1: -8, y1: 0, x2: -3, y2: 0 },
        { type: "line", x1: -6, y1: 2.5, x2: -1, y2: 2.5 },
        { type: "line", x1: 0, y1: -6, x2: 3, y2: -6 },
        { type: "line", x1: 3, y1: -6, x2: 3, y2: -10 },
        ...Array.from({ length: 24 }, (_, i) => {
          const a = (i / 24) * 2 * Math.PI;
          const b = ((i + 1) / 24) * 2 * Math.PI;
          return {
            type: "line",
            x1: 20 + 1.5 * Math.cos(a),
            y1: 1.5 * Math.sin(a),
            x2: 20 + 1.5 * Math.cos(b),
            y2: 1.5 * Math.sin(b),
          };
        }),
      ];
      s.addItem(
        {
          id,
          type: "sketch",
          name: "Measure Sketch",
          children: [],
          parentId: null,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          shapes,
          constraints: [],
        },
        "Added",
      );
      s.selectItem(id);
      s.startMeasureTool();
    }, SKETCH_ID);
    await expect(readout()).toBeVisible();
  });

  test("one sketch line reports its length", async () => {
    await selectShapes(0);
    expect(await readText()).toBe("Length 40.00 mm");
  });

  test("a sketch circle reports circumference, radius and area together", async () => {
    await selectShapes(4);
    const text = await readText();
    // Sampled as a polyline, so the circumference is a hair under 2*pi*r.
    expect(num(text, "Length")).toBeCloseTo(2 * Math.PI * 2 * MM, 0);
    expect(text).toContain("Radius 20.00 mm");
    expect(text).toContain("Diameter 40.00 mm");
    expect(num(text, "Area")).toBeCloseTo(Math.PI * 4 * MM * MM, 0);
  });

  test("a sketch arc reports its length and radius but no area", async () => {
    await selectShapes(5);
    const text = await readText();
    expect(num(text, "Length")).toBeCloseTo((Math.PI / 2) * 3 * MM, 0);
    expect(text).toContain("Radius 30.00 mm");
    expect(text).not.toContain("Area"); // an open arc encloses nothing
  });

  test("four lines that chain into a closed loop report perimeter and area", async () => {
    await selectShapes(0, 1, 2, 3);
    const text = await readText();
    expect(text).toContain("Length (4)");
    expect(num(text, "Length \\(4\\)")).toBeCloseTo(14 * MM, 1); // 2*(4+3)
    expect(num(text, "Area")).toBeCloseTo(12 * MM * MM, 1); // 4*3
  });

  test("two unconnected sketch lines measure centre to centre, and give no area", async () => {
    await selectShapes(6, 7);
    const text = await readText();
    expect(num(text, "Length \\(2\\)")).toBeCloseTo(10 * MM, 1);
    // Mid-points (-5.5,0) and (-3.5,2.5): 2 apart along the lines as well as
    // 2.5 across them.
    expect(num(text, "Distance")).toBeCloseTo(Math.hypot(2, 2.5) * MM, 1);
    expect(text).not.toContain("Area"); // they don't close a loop
  });

  test("three lines that do not close report no area", async () => {
    // An open chain: the loop detector must reject it rather than closing it
    // implicitly, which would invent a triangle that was never drawn.
    await selectShapes(0, 1, 2);
    const text = await readText();
    expect(text).toContain("Length (3)");
    expect(text).not.toContain("Area");
  });

  // A chain is one line to measure: only a second, separate line makes the
  // reading a distance.
  test("two lines joined end to end report one length and no distance", async () => {
    await selectShapes(8, 9);
    const text = await readText();
    expect(num(text, "Length \\(2\\)")).toBeCloseTo(7 * MM, 1); // 3 + 4
    expect(text).not.toContain("Distance");
    expect(text).not.toContain("Diameter");
  });

  test("a ring of lines approximating a circle reports its diameter", async () => {
    await selectShapes(...Array.from({ length: 24 }, (_, i) => 10 + i));
    const text = await readText();
    expect(num(text, "Diameter")).toBeCloseTo(3 * MM, 1);
    expect(text).not.toContain("Distance");
    // A closed loop, so its area too -- the 24-gon's, a hair under pi r^2.
    expect(num(text, "Area")).toBeCloseTo(
      12 * 1.5 * 1.5 * Math.sin((2 * Math.PI) / 24) * MM * MM,
      0,
    );
  });
});
