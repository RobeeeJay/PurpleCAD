// Regression: maxItemId must account for "createGroup" entries (multi-area
// extrude prisms), not just "create" entries — otherwise a freshly-created
// item (e.g. ObjectCreateSection's torus/sphere/etc.) can be handed an id
// that collides with an existing prism. Once two items share an id,
// applyInstruction's id-keyed "transform"/"modify" .map mutates both at
// once — moving the new object also moves the colliding one.

import { describe, it, expect } from "vitest";
import { maxItemId } from "../internals.js";

describe("maxItemId", () => {
  it("ignores createGroup ids when computed naively (would collide)", () => {
    const history = [
      { id: "h1", instruction: { type: "create", item: { id: 1 } } },
      { id: "h2", instruction: { type: "create", item: { id: 2 } } },
      {
        id: "h3",
        instruction: {
          type: "createGroup",
          items: [{ id: 3 }, { id: 4 }],
        },
      },
    ];

    expect(maxItemId(history)).toBe(4);
  });

  it("returns the highest id across plain creates and groups combined", () => {
    const history = [
      {
        id: "h1",
        instruction: { type: "createGroup", items: [{ id: 5 }, { id: 6 }] },
      },
      { id: "h2", instruction: { type: "create", item: { id: 3 } } },
    ];

    expect(maxItemId(history)).toBe(6);
  });

  it("returns 0 for an empty/scene_created-only history", () => {
    const history = [{ id: "h0", instruction: { type: "scene_created" } }];
    expect(maxItemId(history)).toBe(0);
  });
});
