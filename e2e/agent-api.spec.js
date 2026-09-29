// The agent API, driven the way an agent will drive it: named commands with
// JSON arguments, in mm, in the Z-up frame, each returning only once the model
// has settled. No store choreography and no waiting on the UI -- if a test
// here needs either, the API is missing something.
import fs from "node:fs";
import { test, expect } from "./fixtures.js";
import { launchApp } from "./launch.js";

let app;
let page;
let plateId;
let bossId;
let partId;

const call = (name, args) =>
  page.evaluate(({ name, args }) => window.__api.call(name, args), {
    name,
    args,
  });

const ok = async (name, args) => {
  const r = await call(name, args);
  expect(r.ok, `${name} failed: ${JSON.stringify(r.error)}`).toBe(true);
  return r.result;
};

const refused = async (name, args) => {
  const r = await call(name, args);
  expect(r.ok, `${name} was expected to fail`).toBe(false);
  return r.error;
};

// Four lines drawn deliberately at the WRONG size, with the constraints that
// hold them square: the dimensions below have to be what sizes the plate.
const squareOutline = () => {
  const [x, y] = [25, 15];
  const line = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
  const meet = (a, b) => ({
    type: "coincident",
    shapeAIdx: a,
    pointA: "end",
    shapeBIdx: b,
    pointB: "start",
  });
  return {
    shapes: [
      line(-x, -y, x, -y),
      line(x, -y, x, y),
      line(x, y, -x, y),
      line(-x, y, -x, -y),
    ],
    constraints: [
      meet(0, 1),
      meet(1, 2),
      meet(2, 3),
      meet(3, 0),
      { type: "horizontal", shapeIdx: 0 },
      { type: "horizontal", shapeIdx: 2 },
      { type: "vertical", shapeIdx: 1 },
      { type: "vertical", shapeIdx: 3 },
    ],
  };
};

const length = (shapeIdx, distance) => ({
  type: "distance",
  shapeAIdx: shapeIdx,
  pointA: "start",
  shapeBIdx: shapeIdx,
  pointB: "end",
  distance,
});

test.describe.serial("agent API", () => {
  test.beforeAll(async () => {
    app = await launchApp();
    page = await app.firstWindow();
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    await expect(page.locator(".toolbar")).toBeVisible();
  });

  test.afterAll(async () => {
    await app?.close();
  });

  test("lists its commands with the schemas an MCP client needs", async () => {
    const list = await page.evaluate(() => window.__api.list());
    const names = list.map((c) => c.name);
    for (const name of [
      "document.new",
      "variables.set",
      "variables.list",
      "sketch.create",
      "feature.extrude",
      "feature.boolean",
      "body.list",
      "view.render",
    ])
      expect(names).toContain(name);
    for (const c of list) {
      expect(
        c.description.length,
        `${c.name} needs a description`,
      ).toBeGreaterThan(20);
      expect(c.inputSchema.type).toBe("object");
    }
  });

  test("will not discard a document unless told to", async () => {
    expect((await refused("document.new", {})).code).toBe("BAD_ARGS");
    expect(
      (await refused("document.new", { discardCurrent: false })).code,
    ).toBe("CONFIRMATION_REQUIRED");
  });

  test("builds a plate from variables, a constrained sketch and an extrude", async () => {
    await ok("document.new", { discardCurrent: true });
    await ok("variables.set", {
      variables: [
        { name: "Width", value: 60 },
        { name: "Depth", value: 40 },
        { name: "Thick", value: 8 },
      ],
    });
    const { shapes, constraints } = squareOutline();
    const sketch = await ok("sketch.create", {
      plane: "XY",
      name: "Plate outline",
      shapes,
      constraints: [...constraints, length(0, "Width"), length(1, "Depth")],
    });
    expect(sketch.closedRegions).toBe(1);

    const plate = await ok("feature.extrude", {
      sketchId: sketch.id,
      depth: "Thick",
    });
    plateId = plate.id;
    // Sized by the dimensions, not by how the lines were drawn (50 x 30).
    expect(plate.bboxMm.size[0]).toBeCloseTo(60, 1);
    expect(plate.bboxMm.size[1]).toBeCloseTo(40, 1);
    expect(plate.bboxMm.size[2]).toBeCloseTo(8, 1);
    // Sitting ON the XY plane and growing up the Z axis, not sideways.
    expect(plate.bboxMm.min[2]).toBeCloseTo(0, 1);
    expect(plate.volumeMm3).toBeCloseTo(60 * 40 * 8, -1);
  });

  test("adds a boss on top and fuses the two into one body", async () => {
    const boss = await ok("sketch.create", {
      plane: "XY",
      offset: 8,
      shapes: [{ type: "circle", cx: 0, cy: 0, r: 10 }],
    });
    const cyl = await ok("feature.extrude", { sketchId: boss.id, depth: 10 });
    bossId = cyl.id;
    expect(cyl.bboxMm.size[0]).toBeCloseTo(20, 0);
    expect(cyl.bboxMm.min[2]).toBeCloseTo(8, 1);
    expect(cyl.bboxMm.max[2]).toBeCloseTo(18, 1);

    const part = await ok("feature.boolean", {
      operation: "union",
      target: plateId,
      tools: [bossId],
    });
    partId = part.id;
    // Two closed OCC bodies: nothing to warn about.
    expect(part.warning).toBeUndefined();
    expect(part.bboxMm.size[0]).toBeCloseTo(60, 1);
    expect(part.bboxMm.size[2]).toBeCloseTo(18, 1);
    const expected = 60 * 40 * 8 + Math.PI * 10 ** 2 * 10;
    expect(
      Math.abs(part.volumeMm3 - expected) / expected,
      `volume ${part.volumeMm3} against ${expected.toFixed(0)}`,
    ).toBeLessThan(0.015);

    // The inputs are consumed: one body is left in the document.
    const { bodies } = await ok("body.list", {});
    expect(bodies.map((b) => b.id)).toEqual([partId]);
    const all = await ok("body.list", { includeHidden: true });
    expect(all.bodies.length).toBe(3);
  });

  test("returns only once a variable change has rebuilt the part", async () => {
    // No polling: the size read straight back must already be the new one.
    await ok("variables.set", { variables: [{ name: "Width", value: 80 }] });
    const { bodies } = await ok("body.list", {});
    expect(bodies.length).toBe(1);
    expect(bodies[0].bboxMm.size[0]).toBeCloseTo(80, 1);
    expect(bodies[0].bboxMm.size[2]).toBeCloseTo(18, 1);
  });

  test("renders the part for the agent to look at", async ({}, testInfo) => {
    for (const view of ["iso", "top"]) {
      const img = await ok("view.render", { view, width: 640, height: 480 });
      expect(img.mimeType).toBe("image/png");
      const png = Buffer.from(img.data, "base64");
      // The PNG signature, and a picture with something in it.
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(png.length).toBeGreaterThan(5000);
      const file = testInfo.outputPath(`agent-api-${view}.png`);
      fs.writeFileSync(file, png);
      await testInfo.attach(`agent-api-${view}`, {
        path: file,
        contentType: "image/png",
      });
    }
  });

  test("explains a failure instead of throwing", async () => {
    const open = await ok("sketch.create", {
      plane: "XZ",
      shapes: [
        { type: "line", x1: 0, y1: 0, x2: 10, y2: 0 },
        { type: "line", x1: 10, y1: 0, x2: 10, y2: 10 },
      ],
    });
    expect(open.closedRegions).toBe(0);
    expect(
      (await refused("feature.extrude", { sketchId: open.id, depth: 5 })).code,
    ).toBe("NO_PROFILE");

    expect(
      (
        await refused("feature.boolean", {
          operation: "union",
          target: partId,
          tools: [987654],
        })
      ).code,
    ).toBe("NOT_FOUND");

    // One line cannot be both Width and Depth long.
    const clash = await refused("sketch.create", {
      plane: "XY",
      shapes: [{ type: "line", x1: 0, y1: 0, x2: 10, y2: 0 }],
      constraints: [length(0, "Width"), length(0, "Depth")],
    });
    expect(clash.code).toBe("SKETCH_UNSOLVED");
    expect(clash.details.conflictingConstraints.length).toBeGreaterThan(0);

    const shape = await refused("sketch.create", {
      plane: "XY",
      shapes: [{ type: "hexagon", r: 5 }],
    });
    expect(shape.code).toBe("BAD_SHAPE");
    expect(shape.details.supported).toContain("circle");
  });

  test("simplifies a modelled body, to a count or within a deviation", async () => {
    await ok("document.new", { discardCurrent: true });
    // A plate with a round boss fused on: a modelled mesh body, its curved
    // wall tessellated finely enough to be worth simplifying.
    const plate = await ok("sketch.create", {
      plane: "XY",
      shapes: [{ type: "circle", cx: 0, cy: 0, r: 30 }],
    });
    const disc = await ok("feature.extrude", { sketchId: plate.id, depth: 4 });
    const bossSketch = await ok("sketch.create", {
      plane: "XY",
      offset: 4,
      shapes: [{ type: "circle", cx: 0, cy: 0, r: 12 }],
    });
    const boss = await ok("feature.extrude", {
      sketchId: bossSketch.id,
      depth: 10,
    });
    const part = await ok("feature.boolean", {
      operation: "union",
      target: disc.id,
      tools: [boss.id],
    });

    // A plain extrusion has no mesh to reduce.
    expect(
      (await refused("feature.simplify", { bodyId: boss.id, triangles: 50 }))
        .code,
    ).toBe("BAD_ARGS");
    expect(
      (
        await refused("feature.simplify", {
          bodyId: part.id,
          maxDeviationMm: 0.1,
          triangles: 50,
        })
      ).code,
    ).toBe("BAD_ARGS");

    // A modelled body's tessellation is already lean -- at 0.3 mm nothing
    // on this one goes -- so 1 mm, where the arcs' facets can merge.
    const within = await ok("feature.simplify", {
      bodyId: part.id,
      maxDeviationMm: 1,
    });
    expect(within.id).toBe(part.id);
    expect(within.trianglesBefore).toBe(part.triangles);
    expect(within.maxDeviationMm).toBeLessThanOrEqual(1);
    expect(within.triangles).toBeLessThan(part.triangles);
    // Same body, same place: each side can move in by at most the deviation.
    for (let k = 0; k < 3; k++)
      expect(
        Math.abs(within.bboxMm.size[k] - part.bboxMm.size[k]),
      ).toBeLessThanOrEqual(2 * within.maxDeviationMm);

    // A second simplify stacks on the first, on the same body.
    const counted = await ok("feature.simplify", {
      bodyId: part.id,
      triangles: 100,
    });
    expect(counted.triangles).toBeLessThanOrEqual(100);
    expect(counted.maxDeviationMm).toBeGreaterThan(0);
  });
});
