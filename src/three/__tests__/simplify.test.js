// Simplify as a timeline step, through the real store and recalc: it replaces
// a mesh body's triangles in place (same item, same position), it records a
// recipe a timeline Edit re-runs on the same source, and the simplified body
// still takes part in a boolean -- OCC sews its mesh, as for an import.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";
import { commitSimplify } from "../cameraControls/simplify.js";
import { performCsg } from "../occClient.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// A closed UV sphere of radius 1 (10 mm), welded, standing in for an import.
const sphere = (seg = 40) => {
  const positions = [0, 1, 0];
  for (let i = 1; i < seg; i++)
    for (let j = 0; j < seg; j++) {
      const v = (i / seg) * Math.PI;
      const u = (j / seg) * 2 * Math.PI;
      positions.push(
        Math.sin(v) * Math.cos(u),
        Math.cos(v),
        Math.sin(v) * Math.sin(u),
      );
    }
  positions.push(0, -1, 0);
  const south = positions.length / 3 - 1;
  const at = (i, j) =>
    i === 0 ? 0 : i === seg ? south : 1 + (i - 1) * seg + (j % seg);
  const indices = [];
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < seg; j++) {
      if (i !== 0) indices.push(at(i, j), at(i + 1, j), at(i, j + 1));
      if (i !== seg - 1)
        indices.push(at(i, j + 1), at(i + 1, j), at(i + 1, j + 1));
    }
  return { positions, indices, normals: null, flat: true };
};

const O = { x: 0, y: 0, z: 0 };
const doc = () => ({
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
    },
    {
      id: 1,
      label: "Added",
      itemId: 5,
      instruction: {
        type: "create",
        item: {
          id: 5,
          name: "Ball (STL)",
          type: "csg",
          children: [],
          parentId: null,
          position: { x: 3, y: 1, z: -2 },
          rotation: O,
          scale: { x: 1, y: 1, z: 1 },
          geometryData: sphere(),
        },
      },
      hiddenIds: [],
    },
  ],
});

const ball = () => useStore.getState().items.find((i) => i.id === 5);
const tris = (it) => it.geometryData.indices.length / 3;

beforeEach(() => useStore.getState().loadDocument(doc()));

describe("simplify as a timeline step", () => {
  it("replaces the body's mesh in place with fewer triangles", async () => {
    const before = ball();
    const ok = await commitSimplify({
      item: before,
      params: { mode: "deviation", toleranceMm: 0.5, targetTriangles: 1000 },
      printPrecision: 0.1,
    });
    expect(ok).toBe(true);
    const after = ball();
    expect(tris(after)).toBeLessThan(tris(before) / 2);
    // Same body, where it was: the mesh is in its own frame.
    expect(after.position).toEqual(before.position);
    expect(after.regenerator.kind).toBe("simplify");
    // A measured bound, within what was asked (0.5 mm).
    expect(after.regenerator.stats.maxDeviationMm).toBeLessThanOrEqual(0.5);
    expect(useStore.getState().history.at(-1).label).toBe("Simplified");
  }, 60000);

  it("re-runs on the same source when its timeline step is edited", async () => {
    await commitSimplify({
      item: ball(),
      params: { mode: "deviation", toleranceMm: 0.5, targetTriangles: 1000 },
      printPrecision: 0.1,
    });
    const coarse = tris(ball());
    const steps = useStore.getState().history.length;
    const entry = useStore.getState().history.at(-1);

    useStore.getState().updateSimplifyParams(entry.id, {
      mode: "triangles",
      toleranceMm: 0.5,
      targetTriangles: 300,
    });
    await recalculateTimeline();

    const edited = ball();
    // Edited in place: no new step, rebuilt at the new count, and still from
    // the original mesh rather than from the first result.
    expect(useStore.getState().history.length).toBe(steps);
    expect(tris(edited)).toBeLessThanOrEqual(300);
    expect(tris(edited)).toBeLessThan(coarse);
    expect(edited.regenerator.regenFailed).toBeFalsy();
    expect(edited.regenerator.source.geometryData.indices.length / 3).toBe(
      tris({ geometryData: sphere() }),
    );
    expect(edited.regenerator.stats.trianglesAfter).toBe(tris(edited));
  }, 60000);

  it("still takes part in a boolean", async () => {
    await commitSimplify({
      item: ball(),
      params: { mode: "deviation", toleranceMm: 0.5, targetTriangles: 1000 },
      printPrecision: 0.1,
    });
    // A 30 mm cube round the 20 mm ball, clear of it on every side.
    const cube = {
      id: 9,
      type: "cube",
      dimensions: { width: 3, height: 3, depth: 3 },
      position: { x: 3, y: 1, z: -2 },
      rotation: O,
      scale: { x: 1, y: 1, z: 1 },
    };
    const items = [...useStore.getState().items, cube];
    const r = await performCsg({
      selectedItems: [cube, ball()],
      allItems: items,
      operation: "difference",
      printPrecision: 0.1,
    });
    // The cube minus the ball inside it: the cube's 12 triangles plus the
    // ball's surface as a cavity.
    const cavity = (r?.geometryData?.indices?.length ?? 0) / 3;
    expect(cavity, `result triangles ${cavity}`).toBeGreaterThan(12 + 100);
  }, 60000);
});
