// The displacement worker front: dispatch/response correlation, error
// propagation, crash recovery, and cancelTextureWork's true-abort semantics.
// node has no Worker, so a fake one is installed globally per test.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let client;
let workers;

class FakeWorker {
  constructor() {
    workers.push(this);
    this.terminated = false;
  }
  postMessage(msg) {
    this.lastMessage = msg;
  }
  reply(payload) {
    this.onmessage?.({ data: payload });
  }
  crash() {
    this.onerror?.(new Error("boom"));
  }
  terminate() {
    this.terminated = true;
  }
}

beforeEach(async () => {
  workers = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.resetModules();
  client = await import("../textureWorkerClient.js");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("displaceMeshAsync via the worker", () => {
  it("correlates responses by id and resolves the right promise", async () => {
    const p1 = client.displaceMeshAsync({ n: 1 });
    const p2 = client.displaceMeshAsync({ n: 2 });
    expect(workers.length).toBe(1); // singleton worker
    const w = workers[0];
    // Answer the SECOND request first.
    w.reply({ id: 2, result: "two" });
    w.reply({ id: 1, result: "one" });
    expect(await p2).toBe("two");
    expect(await p1).toBe("one");
  });

  it("propagates worker-side errors as rejections", async () => {
    const p = client.displaceMeshAsync({});
    workers[0].reply({ id: 1, error: "too dense" });
    await expect(p).rejects.toThrow("too dense");
  });

  it("a crashed worker rejects everything in flight and is replaced", async () => {
    const p = client.displaceMeshAsync({});
    workers[0].crash();
    await expect(p).rejects.toThrow(/worker failed/i);
    // Next request spawns a fresh worker.
    const p2 = client.displaceMeshAsync({});
    expect(workers.length).toBe(2);
    workers[1].reply({ id: 2, result: "ok" });
    expect(await p2).toBe("ok");
  });

  it("cancelTextureWork terminates mid-run and rejects in-flight requests", async () => {
    const p = client.displaceMeshAsync({});
    client.cancelTextureWork();
    expect(workers[0].terminated).toBe(true);
    await expect(p).rejects.toThrow(/cancelled/);
    // Fresh worker afterwards.
    const p2 = client.displaceMeshAsync({});
    expect(workers.length).toBe(2);
    workers[1].reply({ id: 2, result: "after" });
    expect(await p2).toBe("after");
  });

  it("cancel with nothing in flight is a no-op", () => {
    expect(() => client.cancelTextureWork()).not.toThrow();
  });
});
