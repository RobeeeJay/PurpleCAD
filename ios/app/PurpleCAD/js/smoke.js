// Launched with --smoke, the app runs this once the page has loaded: the
// agent-API plate flow from e2e/agent-api.spec.js, through the real renderer,
// the electronAPI shim and the OCC thread, reporting each step to Swift, which
// prints it and exits 0 only if every check held.  It is the iPad's
// end-to-end check until an XCUITest suite exists.
(function () {
  const report = (msg) => window.webkit.messageHandlers.smoke.postMessage(msg);
  const log = (line) => report({ log: line });
  const t0 = performance.now();
  const ms = () => `${Math.round(performance.now() - t0)} ms`;

  async function waitFor(get, what, timeout = 60000) {
    const start = performance.now();
    for (;;) {
      const v = get();
      if (v) return v;
      if (performance.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  const fails = [];
  const check = (cond, what) => {
    log(`${cond ? "ok  " : "FAIL"} ${what}`);
    if (!cond) fails.push(what);
  };
  const near = (a, b, tol) => Math.abs(a - b) <= tol;

  async function call(name, args) {
    const r = await window.__api.call(name, args);
    if (!r.ok) throw new Error(`${name}: ${JSON.stringify(r.error)}`);
    log(`${name} (${ms()})`);
    return r.result;
  }

  async function run() {
    const api = await waitFor(() => window.__api, "window.__api");
    await waitFor(() => document.querySelector(".toolbar"), "the toolbar");
    log(`app ready (${ms()}), ${api.list().length} commands`);

    const gl = document.createElement("canvas").getContext("webgl2");
    check(!!gl, "WebGL2 is available");

    await call("document.new", { discardCurrent: true });
    await call("variables.set", {
      variables: [
        { name: "Width", value: 60 },
        { name: "Depth", value: 40 },
        { name: "Thick", value: 8 },
      ],
    });
    const meet = (a, b) => ({
      type: "coincident", shapeAIdx: a, pointA: "end", shapeBIdx: b, pointB: "start",
    });
    const length = (i, distance) => ({
      type: "distance", shapeAIdx: i, pointA: "start", shapeBIdx: i, pointB: "end", distance,
    });
    const line = (x1, y1, x2, y2) => ({ type: "line", x1, y1, x2, y2 });
    const sketch = await call("sketch.create", {
      plane: "XY",
      shapes: [line(-25, -15, 25, -15), line(25, -15, 25, 15), line(25, 15, -25, 15), line(-25, 15, -25, -15)],
      constraints: [
        meet(0, 1), meet(1, 2), meet(2, 3), meet(3, 0),
        { type: "horizontal", shapeIdx: 0 }, { type: "horizontal", shapeIdx: 2 },
        { type: "vertical", shapeIdx: 1 }, { type: "vertical", shapeIdx: 3 },
        length(0, "Width"), length(1, "Depth"),
      ],
    });
    const plate = await call("feature.extrude", { sketchId: sketch.id, depth: "Thick" });
    check(near(plate.bboxMm.size[0], 60, 0.1) && near(plate.bboxMm.size[1], 40, 0.1) &&
          near(plate.bboxMm.size[2], 8, 0.1), `plate is 60 x 40 x 8 (${plate.bboxMm.size.map((v) => v.toFixed(2))})`);

    const bossSketch = await call("sketch.create", {
      plane: "XY", offset: 8, shapes: [{ type: "circle", cx: 0, cy: 0, r: 10 }],
    });
    const boss = await call("feature.extrude", { sketchId: bossSketch.id, depth: 10 });
    const part = await call("feature.boolean", { operation: "union", target: plate.id, tools: [boss.id] });
    const expected = 60 * 40 * 8 + Math.PI * 100 * 10;
    check(Math.abs(part.volumeMm3 - expected) / expected < 0.015,
          `union volume ${part.volumeMm3.toFixed(0)} against ${expected.toFixed(0)}`);

    await call("variables.set", { variables: [{ name: "Width", value: 80 }] });
    const { bodies } = await call("body.list", {});
    check(bodies.length === 1 && near(bodies[0].bboxMm.size[0], 80, 0.1) &&
          near(bodies[0].bboxMm.size[2], 18, 0.1),
          `rebuilt after Width = 80 (${bodies.map((b) => b.bboxMm.size.map((v) => v.toFixed(2)))})`);

    // Cancel, the way occClient.cancelOcc sends it: a union of two 2000-gon
    // discs takes seconds (3.1 s on an M-series Mac), and a boolean polls the
    // cancel flag, so a cancel 300 ms in has to cut it short.  The aborted
    // boolean RETURNS (BooleanOp takes Shape() without checking IsDone), with
    // an empty or partial mesh, on the desktop too, where occClient's cancel
    // epoch discards it; so the check is time, and not the full result.
    const disc = (id, x) => {
      const polygon2D = [];
      for (let i = 0; i < 2000; i++) {
        const a = (2 * Math.PI * i) / 2000;
        polygon2D.push({ x: 2 * Math.cos(a) + 0.3 * Math.cos(9 * a), y: 2 * Math.sin(a) });
      }
      const O = { x: 0, y: 0, z: 0 };
      return {
        id, type: "extrude", depth: 1, position: { x, y: 0, z: 0 }, rotation: O, scale: { x: 1, y: 1, z: 1 },
        profile: { sketchId: 900 + id, profileCentroid: { x: 0, y: 0 }, polygon2D, holes: [],
                   position: O, rotation: O, normalWorld: { x: 0, y: 0, z: 1 } },
      };
    };
    const slow = () => {
      const items = [disc(901, 0), disc(902, 1.3)];
      return window.electronAPI.invokeOcc("performCsg", {
        selectedItems: items, allItems: items, operation: "union", printPrecision: 0.1,
      });
    };
    const tris = (r) => (r && r.geometryData ? r.geometryData.indices.length / 3 : 0);
    let t = performance.now();
    const whole = tris(await slow());
    const full = performance.now() - t;
    t = performance.now();
    const pending = slow().then(
      (r) => `returned ${tris(r)} triangles`,
      (e) => `rejected: ${e.message}`,
    );
    await new Promise((r) => setTimeout(r, 300));
    await window.electronAPI.invokeOcc("cancel");
    const outcome = await pending;
    const cut = performance.now() - t;
    check(cut < full / 2 && outcome !== `returned ${whole} triangles`,
          `cancel 300 ms in: ${outcome} after ${cut.toFixed(0)} ms ` +
            `(uncancelled: ${whole} triangles in ${full.toFixed(0)} ms)`);

    const img = await call("view.render", { view: "iso", width: 640, height: 480 });
    check(img.mimeType === "image/png" && img.data.length > 5000,
          `rendered a ${img.data.length}-character PNG`);
    report({ png: img.data });
  }

  run().then(
    () => report({ done: true, ok: fails.length === 0, summary: `${fails.length} failed, ${ms()}` }),
    (e) => report({ done: true, ok: false, summary: `threw: ${e && e.message}` }),
  );
})();
