// "Settled", as the store knows it: no OCC operation in flight and no timeline
// recalculation running.
//
// Held across a quiet window rather than sampled once, because a recalculation
// starts on a debounce after the change that triggers it. Sampling once can
// land in that gap and report idle before the work has even begun -- the same
// race that had an e2e test reading a box's size before its rebuild started.

import { useStore } from "../store";
import { ApiError } from "./registry.js";

const idle = () => {
  const s = useStore.getState();
  return s.pendingOperations === 0 && s.regenProgress == null;
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const SETTLE_QUIET_MS = 250;

export async function waitForSettled({
  quietMs = SETTLE_QUIET_MS,
  timeoutMs = 300_000,
  pollMs = 25,
} = {}) {
  const start = Date.now();
  let quietSince = idle() ? start : null;
  for (;;) {
    await sleep(pollMs);
    if (idle()) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= quietMs) return;
    } else quietSince = null;
    if (Date.now() - start > timeoutMs) {
      const s = useStore.getState();
      throw new ApiError(
        "TIMEOUT",
        `The model did not settle within ${Math.round(timeoutMs / 1000)}s.`,
        {
          pendingOperations: s.pendingOperations,
          regenProgress: s.regenProgress,
        },
      );
    }
  }
}
