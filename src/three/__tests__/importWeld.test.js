// Welding imported meshes, on import and in documents already saved.  Imports
// were stored as triangle soups -- three private vertices per triangle, about
// six times the vertices the surface needs -- and nothing could tell whether a
// mesh was closed.  Welding must keep the surface exactly, leave the timeline
// alone, and never write a stale result over a mesh that changed meanwhile.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import {
  weldExistingMeshes,
  weldForImport,
  openMeshWarning,
} from "../importWeld.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
const FACES = [
  [0, 2, 1],
  [0, 3, 2],
  [4, 5, 6],
  [4, 6, 7],
  [0, 1, 5],
  [0, 5, 4],
  [2, 3, 7],
  [2, 7, 6],
  [1, 2, 6],
  [1, 6, 5],
  [3, 0, 4],
  [3, 4, 7],
];
const soup = (faces = FACES, dx = 0) => {
  const positions = [];
  for (const f of faces)
    for (const v of f)
      positions.push(CORNERS[v][0] + dx, CORNERS[v][1], CORNERS[v][2]);
  return { positions, normals: null, indices: null };
};
const csg = (id, name, geometryData, extra = {}) => ({
  id,
  name,
  type: "csg",
  children: [],
  parentId: null,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  geometryData,
  ...extra,
});
const entry = (id, instruction) => ({
  id,
  label: instruction.type === "createGroup" ? "Split" : "Added",
  itemId: null,
  instruction,
  hiddenIds: [],
});

// A document as saved before welding: an imported STL, and the two pieces of a
// split, all soups; plus a body a later step rebuilt, which must be left alone.
const legacyDoc = () => ({
  version: 1,
  activeHistoryId: null,
  variables: [],
  history: [
    entry(0, { type: "scene_created" }),
    entry(1, { type: "create", item: csg(1, "Part (STL)", soup()) }),
    entry(2, {
      type: "createGroup",
      items: [
        csg(2, "Part (1)", soup(FACES, 2)),
        csg(3, "Part (2)", soup(FACES, 4)),
      ],
    }),
    entry(3, {
      type: "create",
      item: csg(4, "Rebuilt", soup(FACES, 6), {
        regenerator: { kind: "chamfer" },
      }),
    }),
  ],
});

const created = (id) => {
  for (const e of useStore.getState().history) {
    const inst = e.instruction;
    const all = inst.type === "create" ? [inst.item] : (inst.items ?? []);
    const hit = all.find((i) => i?.id === id);
    if (hit) return hit;
  }
  return null;
};

beforeEach(() => useStore.getState().loadDocument(legacyDoc()));

describe("welding meshes already in a document", () => {
  it("welds an imported STL and the pieces of a split", async () => {
    expect(await weldExistingMeshes()).toBe(3);
    for (const id of [1, 2, 3]) {
      const g = created(id).geometryData;
      expect(g.positions.length / 3, `item ${id} vertices`).toBe(8);
      expect(g.indices).toHaveLength(36);
      expect(g.flat).toBe(true);
    }
  });

  it("keeps each surface exactly where it was", async () => {
    const before = created(2).geometryData.positions.slice();
    await weldExistingMeshes();
    const g = created(2).geometryData;
    // Re-expand the welded triangles: the same positions, in the same order.
    const again = g.indices.flatMap((i) => g.positions.slice(3 * i, 3 * i + 3));
    expect(again).toEqual(before);
  });

  it("adds no timeline step and leaves a rebuilt body alone", async () => {
    const labels = useStore.getState().history.map((h) => h.label);
    await weldExistingMeshes();
    expect(useStore.getState().history.map((h) => h.label)).toEqual(labels);
    expect(created(4).geometryData.flat).toBeUndefined();
  });

  it("does nothing the second time", async () => {
    await weldExistingMeshes();
    expect(await weldExistingMeshes()).toBe(0);
  });

  it("still welds the next document after one with nothing to weld", async () => {
    // A pass that found nothing finished without pausing, cleared its guard
    // before the guard was even set, and left it set: every later document --
    // a project switch, a file opened -- silently stayed unwelded.
    await weldExistingMeshes();
    expect(await weldExistingMeshes()).toBe(0);
    useStore.getState().loadDocument(legacyDoc());
    expect(await weldExistingMeshes()).toBe(3);
  });

  it("never writes a stale result over a mesh that changed meanwhile", async () => {
    const pending = weldExistingMeshes();
    // While the weld runs, item 1's mesh is replaced by something else.
    const other = soup(FACES, 10);
    useStore.getState().replaceCreatedGeometry({ 1: other });
    await pending;
    expect(created(1).geometryData).toBe(other);
    // The untouched pieces were still welded.
    expect(created(2).geometryData.flat).toBe(true);
  });
});

describe("welding on import", () => {
  it("welds a closed STL and has nothing to warn about", async () => {
    const { geometryData, report } = await weldForImport(soup());
    expect(geometryData.positions.length / 3).toBe(8);
    expect(report.openEdges).toBe(0);
    expect(openMeshWarning("Part (STL)", report)).toBeNull();
  });

  it("warns about an STL with a hole", async () => {
    const lidless = FACES.slice(0, 2).concat(FACES.slice(4));
    const { report } = await weldForImport(soup(lidless));
    expect(openMeshWarning("Box (STL)", report)).toBe(
      "Box (STL) isn't a closed solid: it has 4 open edges. Booleans with it may leave holes.",
    );
  });
});
