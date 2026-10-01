// Combine, toggled while editing an extrusion.  Off on a merged extrusion: it
// becomes its own object again and the body it had merged into shows again.
// On for a standalone one: it merges into the body, which is hidden from its
// step on, as a fresh merge would be.  Driven through the real store and the
// timeline recalculation.
import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };
const cube = {
  id: 1,
  name: "Block",
  type: "cube",
  children: [],
  parentId: null,
  position: O,
  rotation: O,
  scale: S,
};
// A 1 x 1 square prism from z = 0 up 30 mm: it pokes 2 units out of the cube's
// top (the cube spans z -1..1).
const prism = (id) => ({
  id,
  name: `Extrude ${id}`,
  type: "extrude",
  children: [],
  profile: {
    type: "sketchLoop",
    sketchId: null,
    polygon2D: [
      { x: -0.5, y: -0.5 },
      { x: 0.5, y: -0.5 },
      { x: 0.5, y: 0.5 },
      { x: -0.5, y: 0.5 },
    ],
    holes: [],
    position: O,
    rotation: O,
    normalWorld: { x: 0, y: 0, z: 1 },
  },
  depth: "30",
  position: O,
  rotation: O,
  scale: S,
});
const entry = (id, label, instruction, hiddenIds = []) => ({
  id,
  label,
  itemId: instruction.item?.id ?? null,
  instruction,
  hiddenIds,
});
const load = (history) =>
  useStore.getState().loadDocument({
    version: 1,
    activeHistoryId: null,
    variables: [],
    history,
  });

// World z-extent of an item's baked mesh.
const zRange = (id) => {
  const it = useStore.getState().items.find((i) => i.id === id);
  const p = it.geometryData.positions;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 2; i < p.length; i += 3) {
    lo = Math.min(lo, p[i] + it.position.z);
    hi = Math.max(hi, p[i] + it.position.z);
  }
  return [+lo.toFixed(3), +hi.toFixed(3)];
};
const hiddenAtEnd = () => useStore.getState().history.at(-1).hiddenIds ?? [];

describe("Combine toggled while editing an extrusion", () => {
  it("off: a merged extrusion stands alone and the body shows again", async () => {
    // Built as the merge would be: an extrudeUnion over the cube, which is
    // hidden from the merge's step on.
    const merged = {
      id: 3,
      name: "Extruded 3",
      type: "csg",
      children: [],
      parentId: null,
      position: O,
      rotation: O,
      scale: S,
      regenerator: {
        kind: "extrudeUnion",
        extrudeDefs: [prism(4)],
        inputIds: [1],
        originalCenter: O,
        regeneratedAt: "dirty",
      },
    };
    load([
      entry(0, "Scene created", { type: "scene_created" }),
      entry(1, "Added", { type: "create", item: cube }),
      entry(2, "Added", { type: "create", item: merged }, [1]),
    ]);
    await recalculateTimeline();
    expect(zRange(3), "merged: cube and prism").toEqual([-1, 3]);

    useStore.getState().setExtrudeUnionHosts(3, []);
    await recalculateTimeline();
    expect(zRange(3), "the prism alone").toEqual([0, 3]);
    expect(hiddenAtEnd(), "the cube shows again").not.toContain(1);
  }, 120000);

  it("on: a standalone extrusion merges into the body, which is hidden", async () => {
    load([
      entry(0, "Scene created", { type: "scene_created" }),
      entry(1, "Added", { type: "create", item: cube }),
      entry(2, "Added", { type: "create", item: prism(2) }),
    ]);
    await recalculateTimeline();

    useStore.getState().fuseExtrudeIntoHosts(2, [1]);
    await recalculateTimeline();
    const it = useStore.getState().items.find((i) => i.id === 2);
    // The same object, now a merged extrusion over the cube.
    expect(it.type).toBe("csg");
    expect(it.regenerator.kind).toBe("extrudeUnion");
    expect(it.regenerator.inputIds).toEqual([1]);
    expect(it.regenerator.regenFailed).toBeFalsy();
    expect(zRange(2), "cube and prism").toEqual([-1, 3]);
    expect(hiddenAtEnd(), "the cube is merged in").toContain(1);
    // The prism recipe took a fresh id, not one already used.
    expect(it.regenerator.extrudeDefs[0].id).toBe(3);
    // Still one step: edited in place.
    expect(useStore.getState().history.map((h) => h.label)).toEqual([
      "Scene created",
      "Added",
      "Added",
    ]);
  }, 120000);
});
