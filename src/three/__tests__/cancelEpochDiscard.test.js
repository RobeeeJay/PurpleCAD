// runOp's soft cancel layer: a result that lands AFTER the cancel epoch
// bumped must be discarded (return null), and an op issued after a cancel
// must still run normally.  This is the backstop for ops that finish before
// the native abort flag is seen — a stale result reaching the UI re-applies
// geometry the user just cancelled.

import { describe, it, expect, vi } from "vitest";

let resolveOp;
vi.mock("../occOps.js", () => ({
  ops: {
    chamferOrFilletItem: () =>
      new Promise((resolve) => {
        resolveOp = resolve;
      }),
    shellItem: async () => ({ geometryData: { positions: [1, 2, 3] } }),
  },
}));

import { chamferOrFilletItem, shellItem } from "../occClient.js";
import { useStore } from "../../store";

describe("runOp cancel-epoch discard", () => {
  it("discards a result that lands after a cancel, then runs fresh ops", async () => {
    const pending = chamferOrFilletItem({});
    // Let runOp pass its pre-start cancel check and reach the op.
    await new Promise((r) => setTimeout(r, 10));

    useStore.getState().requestOperationCancel();
    resolveOp({ geometryData: { positions: [9, 9, 9] } });

    expect(await pending).toBeNull(); // completed, but discarded

    // The epoch only affects ops in flight at cancel time.
    const fresh = await shellItem({});
    expect(fresh).toEqual({ geometryData: { positions: [1, 2, 3] } });
  });

  it("skips an op whose epoch was bumped before it started", async () => {
    const p = shellItem({});
    useStore.getState().requestOperationCancel(); // lands in the setTimeout(0) window
    expect(await p).toBeNull();
  });
});
