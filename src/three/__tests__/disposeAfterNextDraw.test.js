import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { disposeAfterNextDraw, takeRenderRequest } from "../renderRequest.js";

// Disposing a replaced material before its replacement is drawn lets three.js
// delete the shared shader program, and the replacement recompiles it.
describe("disposeAfterNextDraw", () => {
  let queue;
  const runFrame = () => {
    const due = queue;
    queue = [];
    due.forEach((f) => f());
  };
  beforeEach(() => {
    queue = [];
    globalThis.requestAnimationFrame = (f) => queue.push(f);
  });
  afterEach(() => {
    delete globalThis.requestAnimationFrame;
  });

  const resource = () => {
    const r = { disposed: false, dispose: () => (r.disposed = true) };
    return r;
  };

  it("waits for a frame to be drawn, then disposes", () => {
    const renderer = { info: { render: { frame: 7 } } };
    const r = resource();
    takeRenderRequest();
    disposeAfterNextDraw(renderer, [r]);
    expect(takeRenderRequest()).toBe(true); // asks for the frame it waits on
    runFrame();
    runFrame();
    expect(r.disposed).toBe(false); // nothing drawn yet
    renderer.info.render.frame++;
    runFrame();
    expect(r.disposed).toBe(true);
  });

  it("disposes anyway when the loop has stopped drawing", () => {
    const renderer = { info: { render: { frame: 0 } } };
    const r = resource();
    disposeAfterNextDraw(renderer, [r]);
    for (let i = 0; i < 59; i++) runFrame();
    expect(r.disposed).toBe(false);
    runFrame();
    expect(r.disposed).toBe(true);
  });
});
