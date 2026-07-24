// A boss extrude fuses into its host solid — but NEVER a HIDDEN one.  The user
// hid it deliberately; fusing it would consume it into a CSG result and make it
// reappear.  Cuts already enforce this (resolveCutTargets); this pins the same
// rule for the union path (unionTargetIdsFor + runExtrudeUnion's host filter),
// which previously fused a hidden host regardless — visible most obviously for
// a backward/negative extrude whose prism overlaps the hidden body's region.
import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { runExtrudeUnion } from "../cameraControls/extrudeBoolean.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };
const bossDef = (id) => ({
  id,
  type: "extrude",
  name: `boss ${id}`,
  children: [],
  profile: {
    type: "sketchLoop",
    sketchId: null,
    polygon2D: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
    holes: [],
    position: O,
    rotation: O,
    normalWorld: { x: 0, y: 0, z: 1 },
  },
  depth: "5",
  position: O,
  rotation: O,
  scale: S,
});
const docWithHost = (visible) => ({
  version: 1,
  activeHistoryId: null,
  variables: [],
  history: [
    {
      id: 0,
      label: "Scene created",
      itemId: null,
      instruction: { type: "scene_created" },
      hiddenIds: [],
      _orphaned: false,
    },
    {
      id: 1,
      label: "Added",
      itemId: 5,
      instruction: {
        type: "create",
        item: {
          id: 5,
          name: "Host",
          type: "cube",
          children: [],
          parentId: null,
          position: O,
          rotation: O,
          scale: S,
          dimensions: { width: 4, height: 4, depth: 4 },
          visible,
        },
      },
      hiddenIds: [],
      _orphaned: false,
    },
  ],
});

describe("extrude union host visibility", () => {
  it("does not fuse or consume a HIDDEN host", async () => {
    useStore.getState().loadDocument(docWithHost(false));
    await runExtrudeUnion([bossDef(101)], [5], 200);
    const items = useStore.getState().items;
    expect(items.find((i) => i.id === 5)).toBeTruthy(); // not consumed
    const created = items.find((i) => i.id === 200);
    if (created) expect(created.regenerator.inputIds).toEqual([]); // not fused
  }, 60000);

  it("still fuses a VISIBLE host (control)", async () => {
    useStore.getState().loadDocument(docWithHost(true));
    await runExtrudeUnion([bossDef(101)], [5], 200);
    const created = useStore.getState().items.find((i) => i.id === 200);
    expect(created).toBeTruthy();
    expect(created.regenerator.inputIds).toEqual([5]);
  }, 60000);
});
