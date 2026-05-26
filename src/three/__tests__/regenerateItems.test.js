// Regression: the orchestrator drives the BusyIndicator's progress bar
// from the `onProgress` callback regenerateItemsForResolution fires for
// every item that actually needs to be regenerated.

import { describe, it, expect, vi } from "vitest";

vi.mock("../occClient.js", () => ({
  // Pretend every CSG/chamfer regen succeeds — we only need the
  // progress-callback behaviour here, not real OCC output.
  chamferOrFilletItem: vi.fn(async () => ({
    geometryData: { positions: [0, 0, 0], normals: null, indices: null },
    centerOffset: { cx: 0, cy: 0, cz: 0 },
  })),
  performCsg: vi.fn(async () => ({
    position: { x: 0, y: 0, z: 0 },
    geometryData: { positions: [0, 0, 0], normals: null, indices: null },
  })),
}));

import { regenerateItemsForResolution } from "../regenerateItems.js";

describe("regenerateItemsForResolution onProgress", () => {
  it("fires onProgress with the count of items that actually need regen — skipping items already at the requested precision", async () => {
    const items = [
      // Plain primitive: no regenerator → NOT counted.
      { id: 1, type: "cube" },
      // Boolean regenerator at preview already, regen requested for
      // preview again: skip → NOT counted.
      {
        id: 2,
        type: "csg",
        position: { x: 0, y: 0, z: 0 },
        geometryData: { positions: [], normals: null, indices: null },
        regenerator: {
          kind: "boolean",
          op: "union",
          inputIds: [1],
          regeneratedAt: null,
        },
      },
      // Boolean regenerator with a "dirty" sentinel: counts.
      {
        id: 3,
        type: "csg",
        position: { x: 0, y: 0, z: 0 },
        regenerator: {
          kind: "boolean",
          op: "difference",
          inputIds: [1, 2],
          regeneratedAt: "dirty",
        },
      },
      // Chamfer regen needed: counts.
      {
        id: 4,
        type: "csg",
        position: { x: 0, y: 0, z: 0 },
        regenerator: {
          kind: "chamfer",
          source: { id: 1, type: "cube", position: { x: 0, y: 0, z: 0 } },
          subGeo: { edges: [], faces: [{ nx: 0, ny: 1, nz: 0 }] },
          amount: 0.05,
          segments: 1,
          regeneratedAt: "dirty",
        },
      },
    ];

    const events = [];
    await regenerateItemsForResolution(items, null, (p) => events.push(p));

    // First call is an initial { current: 0, total: 2 } so the UI can
    // render an empty bar before any work has finished.
    expect(events[0]).toEqual({ current: 0, total: 2 });
    // Last call reports total work done.
    expect(events[events.length - 1]).toEqual({ current: 2, total: 2 });
    // Monotonic non-decreasing current.
    for (let i = 1; i < events.length; i++) {
      expect(events[i].current).toBeGreaterThanOrEqual(events[i - 1].current);
      expect(events[i].total).toBe(2);
    }
  });

  it("emits a {0,0} progress event and finishes immediately when nothing needs regen", async () => {
    const items = [{ id: 1, type: "cube" }];
    const events = [];
    await regenerateItemsForResolution(items, null, (p) => events.push(p));
    expect(events).toEqual([{ current: 0, total: 0 }]);
  });
});
