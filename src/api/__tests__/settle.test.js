// "Settled" is what lets a command return a finished result instead of making
// an agent poll. Returning early is the failure that matters: a recalculation
// starts after the change that triggers it, and a command that samples idle
// once can report a size from before the rebuild.
import { afterEach, describe, it, expect } from "vitest";
import { useStore } from "../../store";
import { waitForSettled } from "../settle.js";

const busy = (patch) => useStore.setState(patch);

afterEach(() => busy({ pendingOperations: 0, regenProgress: null }));

describe("waiting for the model to settle", () => {
  it("waits out an OCC operation, then a quiet window", async () => {
    busy({ pendingOperations: 1 });
    setTimeout(() => busy({ pendingOperations: 0 }), 80);
    const t0 = Date.now();
    await waitForSettled({ quietMs: 60 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(140);
  });

  it("counts a running recalculation as busy", async () => {
    busy({ regenProgress: { current: 0, total: 2 } });
    setTimeout(() => busy({ regenProgress: null }), 80);
    const t0 = Date.now();
    await waitForSettled({ quietMs: 40 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(120);
  });

  it("starts the quiet window again when work begins inside it", async () => {
    // Idle at first -- the gap before a debounced recalculation begins.
    setTimeout(() => busy({ pendingOperations: 1 }), 30);
    setTimeout(() => busy({ pendingOperations: 0 }), 60);
    const t0 = Date.now();
    await waitForSettled({ quietMs: 100 });
    expect(Date.now() - t0).toBeGreaterThanOrEqual(160);
  });

  it("gives up with the busy state when nothing settles", async () => {
    busy({ pendingOperations: 2 });
    await expect(
      waitForSettled({ quietMs: 20, timeoutMs: 120 }),
    ).rejects.toMatchObject({
      code: "TIMEOUT",
      details: { pendingOperations: 2 },
    });
  });
});
