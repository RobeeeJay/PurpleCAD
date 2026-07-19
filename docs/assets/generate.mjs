// Documentation asset generator for PurpleCAD.
//
// Launches the real Electron app (via the e2e launcher) and captures the
// screenshots and short animations embedded in the docs.  Each capture is
// isolated in a try/catch so one failure doesn't abort the batch.
//
//   node docs/assets/generate.mjs            # all assets
//   node docs/assets/generate.mjs interface  # only matching names
//
// Animations are built by capturing a sequence of frames during a scripted
// flow, then assembling them into a GIF with ffmpeg.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { launchApp } from "../../e2e/launch.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = here;
const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.some((s) => name.includes(s));

const sketchGround = (id, shapes = [], constraints = []) => ({
  id,
  type: "sketch",
  name: `Sketch ${id}`,
  children: [],
  parentId: null,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: -Math.PI / 2, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  shapes,
  constraints,
});
const cube = (id, x, y, z, s = 1, name = `Cube ${id}`) => ({
  id,
  name,
  type: "cube",
  children: [],
  position: { x, y, z },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: s, y: s, z: s },
});

async function run() {
  const results = [];
  const shot = async (page, name, { clip } = {}) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot(clip ? { path: file, clip } : { path: file });
    results.push(name + ".png");
  };
  // Reset to an empty document with a single selected sketch/none.
  const app = await launchApp();
  const page = await app.firstWindow();
  await page.locator(".toolbar").waitFor();
  const reset = async () => {
    await page.evaluate(() => window.__store.getState().newDocument());
    await page.waitForTimeout(400);
  };
  const settle = (ms = 900) => page.waitForTimeout(ms);

  const shots = [];

  // ── The interface (empty 3D view) ────────────────────────────────────────
  shots.push([
    "interface",
    async () => {
      await reset();
      await settle(500);
      await shot(page, "interface");
    },
  ]);

  // ── Primitives ───────────────────────────────────────────────────────────
  shots.push([
    "primitives",
    async () => {
      await reset();
      await page.evaluate(() => {
        const s = window.__store.getState();
        const add = (id, type, x, dims) =>
          s.addItem({
            id,
            name: type,
            type,
            children: [],
            position: { x, y: 1, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
            dimensions: dims,
          });
        add(1, "cube", -5);
        add(2, "sphere", -2.5, { radius: 1 });
        add(3, "cylinder", 0, { radius: 0.9, height: 2 });
        add(4, "cone", 2.5, { radiusBottom: 1, radiusTop: 0, height: 2 });
        add(5, "torus", 5.5, { radius: 1, tube: 0.35 });
        s.selectItem(null);
      });
      await settle(1200);
      await shot(page, "primitives");
    },
  ]);

  shots.push([
    "primitive-selected",
    async () => {
      await reset();
      await page.evaluate(() => {
        const s = window.__store.getState();
        s.addItem({
          id: 1,
          name: "Box",
          type: "cube",
          children: [],
          position: { x: 0, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1.2, y: 0.8, z: 1 },
        });
        s.selectItem(1);
      });
      await settle(1000);
      await shot(page, "primitive-selected");
    },
  ]);

  // ── Sketch: rectangle + draw tools ───────────────────────────────────────
  shots.push([
    "sketch-shapes",
    async () => {
      await reset();
      await page.evaluate(
        ([sk]) => {
          const s = window.__store.getState();
          s.addItem(sk);
          s.selectItem(sk.id);
        },
        [
          sketchGround(300, [
            { type: "line", x1: -6, y1: 2, x2: -2, y2: 2 },
            { type: "line", x1: -2, y1: 2, x2: -2, y2: 5 },
            { type: "circle", cx: 2, cy: 3.5, r: 1.5 },
            {
              type: "arc",
              cx: 6,
              cy: 3,
              r: 1.5,
              startAngle: 0,
              endAngle: Math.PI,
            },
            { type: "rect", x1: -6, y1: -5, x2: -1, y2: -1 },
            {
              type: "bezier",
              p0: { x: 1, y: -1 },
              p1: { x: 2, y: -4 },
              p2: { x: 5, y: -4 },
              p3: { x: 6, y: -1 },
            },
            { type: "point", x: 3, y: -5 },
          ]),
        ],
      );
      await settle(1600);
      await shot(page, "sketch-shapes");
    },
  ]);

  // ── Sketch: constrained + dimensioned rectangle ──────────────────────────
  shots.push([
    "sketch-constraints",
    async () => {
      await reset();
      await page.evaluate(
        ([sk]) => {
          const s = window.__store.getState();
          s.addItem(sk);
          s.selectItem(sk.id);
        },
        [
          sketchGround(
            300,
            [
              { type: "line", x1: -4, y1: -3, x2: 4, y2: -3 },
              { type: "line", x1: 4, y1: -3, x2: 4, y2: 3 },
              { type: "line", x1: 4, y1: 3, x2: -4, y2: 3 },
              { type: "line", x1: -4, y1: 3, x2: -4, y2: -3 },
            ],
            [
              { type: "horizontal", shapeIdx: 0 },
              { type: "vertical", shapeIdx: 1 },
              { type: "horizontal", shapeIdx: 2 },
              { type: "vertical", shapeIdx: 3 },
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
              {
                type: "distance",
                shapeAIdx: 0,
                pointA: "start",
                shapeBIdx: 0,
                pointB: "end",
                distance: "80",
              },
              {
                type: "distance",
                shapeAIdx: 1,
                pointA: "start",
                shapeBIdx: 1,
                pointB: "end",
                distance: "60",
              },
            ],
          ),
        ],
      );
      await settle(1600);
      await shot(page, "sketch-constraints");
    },
  ]);

  // ── Sketch: fillets (convex + concave) ───────────────────────────────────
  shots.push([
    "sketch-fillet",
    async () => {
      await reset();
      await page.evaluate(
        ([sk]) => {
          const s = window.__store.getState();
          s.addItem(sk);
          s.selectItem(sk.id);
          s.setSketchModifyMode("bevel");
          s.setSketchModifyDistMm("10");
        },
        [
          sketchGround(300, [
            { type: "line", x1: -5, y1: -3, x2: 5, y2: -3 },
            { type: "line", x1: 5, y1: -3, x2: 5, y2: 3 },
          ]),
        ],
      );
      await settle(1500);
      await shot(page, "sketch-fillet");
    },
  ]);

  // ── Material dialog ──────────────────────────────────────────────────────
  shots.push([
    "material",
    async () => {
      await reset();
      await page.evaluate(() => {
        const s = window.__store.getState();
        s.addItem({
          id: 1,
          name: "Box",
          type: "cube",
          children: [],
          position: { x: 0, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1.2, y: 1, z: 1 },
        });
        s.selectItem(1);
      });
      await settle(900);
      await page
        .getByTitle("Material — edit the material for", { exact: false })
        .click()
        .catch(() => {});
      await settle(500);
      await shot(page, "material");
    },
  ]);

  // ── Variables dialog ─────────────────────────────────────────────────────
  shots.push([
    "variables",
    async () => {
      await reset();
      await page.evaluate(() => {
        const s = window.__store.getState();
        s.setVariables([
          { name: "Width", formula: "80" },
          { name: "Depth", formula: "60" },
          { name: "WallThickness", formula: "2" },
          { name: "HoleDia", formula: "Width / 16" },
        ]);
        s.setVariablesDialogOpen(true);
      });
      await settle(500);
      await shot(page, "variables");
    },
  ]);

  // ── Save / export menu open ──────────────────────────────────────────────
  shots.push([
    "save-menu",
    async () => {
      await reset();
      await settle(300);
      await page
        .getByTitle("Save / Export", { exact: false })
        .first()
        .click()
        .catch(() => {});
      await settle(400);
      await shot(page, "save-menu");
    },
  ]);

  // ── Wireframe render mode ────────────────────────────────────────────────
  shots.push([
    "render-wireframe",
    async () => {
      await reset();
      await page.evaluate(() => {
        const s = window.__store.getState();
        s.addItem({
          id: 1,
          name: "Cylinder",
          type: "cylinder",
          children: [],
          position: { x: 0, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          dimensions: { radius: 1.2, height: 2.2 },
        });
        s.selectItem(null);
      });
      await settle(900);
      await page.getByTitle("Wireframe", { exact: false }).click().catch(() => {});
      await settle(500);
      await shot(page, "render-wireframe");
    },
  ]);

  await runShots(shots, page, want);

  // ── Animation: draw a rectangle in a sketch ──────────────────────────────
  if (want("draw-rectangle")) {
    try {
      await reset();
      await page.evaluate(
        ([sk]) => {
          const s = window.__store.getState();
          s.addItem(sk);
          s.selectItem(sk.id);
        },
        [sketchGround(300)],
      );
      await settle(2400);
      const size = page.viewportSize() || { width: 1400, height: 868 };
      // Calibrate the ground sketch's screen mapping with a probe line.
      const p1 = { x: size.width * 0.5, y: size.height * 0.4 };
      const p2 = { x: size.width * 0.7, y: size.height * 0.65 };
      await page.evaluate(() =>
        window.__store.getState().setActiveSketchTool("line"),
      );
      await page.mouse.click(p1.x, p1.y);
      await page.mouse.click(p2.x, p2.y);
      await page.keyboard.press("Escape");
      const probe = await page.evaluate(
        () => window.__store.getState().items.find((i) => i.id === 300).shapes[0],
      );
      const a = (p2.x - p1.x) / (probe.x2 - probe.x1);
      const b = p1.x - a * probe.x1;
      const c = (p2.y - p1.y) / (probe.y2 - probe.y1);
      const d = p1.y - c * probe.y1;
      const toScreen = (lx, ly) => ({ x: a * lx + b, y: c * ly + d });
      await page.evaluate(() => window.__store.getState().undoSketch(300));
      await page.evaluate(() =>
        window.__store.getState().setActiveSketchTool("rect"),
      );
      const A = toScreen(-3, -2.5);
      const B = toScreen(3, 2.5);
      const frames = await captureFrames(page, "draw-rectangle", async (cap) => {
        await page.mouse.move(A.x, A.y);
        await cap();
        await page.mouse.down();
        await page.mouse.move(A.x, A.y);
        await cap();
        const steps = 8;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps;
          await page.mouse.move(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t);
          await cap();
        }
        await page.mouse.up();
        await cap();
        await cap();
      });
      makeGif("draw-rectangle", frames);
      results.push("draw-rectangle.gif");
    } catch (e) {
      console.log("draw-rectangle animation failed:", e.message);
    }
  }

  // ── Real OCC flows (extrude, boolean) via the actual tools ───────────────
  if (want("extrude")) {
    try {
      await reset();
      await page.evaluate(
        ([sk]) => {
          const s = window.__store.getState();
          s.addItem(sk);
          s.selectItem(sk.id);
        },
        [
          sketchGround(300, [
            { type: "line", x1: -3, y1: -3, x2: 3, y2: -3 },
            { type: "line", x1: 3, y1: -3, x2: 3, y2: 3 },
            { type: "line", x1: 3, y1: 3, x2: -3, y2: 3 },
            { type: "line", x1: -3, y1: 3, x2: -3, y2: -3 },
          ]),
        ],
      );
      await settle(1600);
      await shot(page, "extrude-sketch");
    } catch (e) {
      console.log("extrude-sketch failed:", e.message);
    }
  }

  if (want("boolean")) {
    try {
      await reset();
      await page.evaluate(
        ([a, b]) => {
          const s = window.__store.getState();
          s.addItem(a);
          s.addItem(b);
          s.startBooleanTool("union");
          window.__store.setState({ selectedIds: [1, 2] });
        },
        [cube(1, -0.6, 1, 0, 1, "Cube 1"), cube(2, 0.6, 1, 0.4, 1, "Cube 2")],
      );
      await settle(1200);
      await shot(page, "boolean-setup");
    } catch (e) {
      console.log("boolean-setup failed:", e.message);
    }
  }

  await app.close();
  console.log("Generated:", results.join(", "));
}

// Capture a sequence of PNG frames into a temp dir; `flow(cap)` calls `cap()`
// at each moment worth a frame.  Returns the temp dir of frame files.
async function captureFrames(page, name, flow) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pcad-frames-${name}-`));
  let n = 0;
  const cap = async () => {
    await page.waitForTimeout(70);
    await page.screenshot({
      path: path.join(dir, `f${String(n++).padStart(3, "0")}.png`),
    });
  };
  await flow(cap);
  return dir;
}

// Assemble frames into a looping GIF (downscaled for a lightweight doc asset).
function makeGif(name, framesDir) {
  const out = path.join(OUT, `${name}.gif`);
  const palette = path.join(framesDir, "palette.png");
  const scale = "scale=900:-1:flags=lanczos";
  execFileSync("ffmpeg", [
    "-y",
    "-framerate", "8",
    "-i", path.join(framesDir, "f%03d.png"),
    "-vf", `${scale},palettegen`,
    palette,
  ]);
  execFileSync("ffmpeg", [
    "-y",
    "-framerate", "8",
    "-i", path.join(framesDir, "f%03d.png"),
    "-i", palette,
    "-lavfi", `${scale} [x]; [x][1:v] paletteuse`,
    "-loop", "0",
    out,
  ]);
  fs.rmSync(framesDir, { recursive: true, force: true });
}

async function runShots(shots, page, wantFn) {
  for (const [name, fn] of shots) {
    if (!wantFn(name)) continue;
    try {
      await fn();
    } catch (e) {
      console.log(`${name} failed:`, e.message);
    }
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
