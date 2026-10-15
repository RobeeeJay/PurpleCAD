// New items must never take an id a Split already used.  A Split's pieces are
// created in one "createGroup" step; id counters that scanned only single
// "create" steps missed them.  In MultiSystem2 that gave a new sketch the id of
// a deleted split piece, then gave a merged extrude the id of the surviving
// piece it merged into: two objects with one id, a doubled entry in the object
// list, and an extrude editor that found the piece instead of the extrude.
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { runCutExtrusion } from "../cameraControls/extrudeBoolean.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };
const cube = (id, name, x) => ({
  id,
  name,
  type: "cube",
  children: [],
  parentId: null,
  position: { x, y: 0, z: 0 },
  rotation: O,
  scale: S,
});
const entry = (id, label, instruction, hiddenIds = []) => ({
  id,
  label,
  itemId: instruction.item?.id ?? instruction.itemId ?? null,
  instruction,
  hiddenIds,
});
// A bore through piece 3, created -- as the old counter did -- with id 2, the
// id of the piece the user deleted.
const bore = {
  id: 2,
  name: "Extrude 2",
  type: "extrude",
  profile: {
    type: "sketchLoop",
    sketchId: null,
    polygon2D: Array.from({ length: 24 }, (_, i) => {
      const a = (i / 24) * 2 * Math.PI;
      return { x: 3 + Math.cos(a) * 0.3, y: Math.sin(a) * 0.3 };
    }),
    holes: [],
    position: O,
    rotation: O,
    normalWorld: { x: 0, y: 0, z: 1 },
  },
  depth: "40",
  startOffset: -2,
  isCut: true,
  position: O,
  rotation: O,
  scale: S,
};

beforeEach(() =>
  useStore.getState().loadDocument({
    version: 1,
    activeHistoryId: null,
    variables: [],
    history: [
      entry(0, "Scene created", { type: "scene_created" }),
      entry(1, "Added", { type: "create", item: cube(1, "Body", 0) }),
      entry(
        2,
        "Split",
        {
          type: "createGroup",
          splitFrom: 1,
          items: [cube(2, "Body (1)", 0), cube(3, "Body (2)", 3)],
        },
        [1],
      ),
      entry(3, "Deleted", { type: "delete", itemId: 2 }, [1]),
      entry(4, "Added", { type: "create", item: bore }, [1]),
    ],
  }),
);

describe("item ids after a Split", () => {
  it("a cut's result takes a fresh id, not a split piece's", async () => {
    await runCutExtrusion(2, 3);
    const ids = useStore.getState().history.flatMap((h) => {
      const i = h.instruction;
      return i.type === "create"
        ? [i.item.id]
        : (i.items ?? []).map((x) => x.id);
    });
    const cut = useStore
      .getState()
      .items.find((i) => i.type === "csg" && /^Cut /.test(i.name));
    expect(cut, "the cut result").toBeTruthy();
    // Ids used so far: 1, 2 (twice already -- the fixture's own reuse), 3.
    expect(cut.id, `created ids ${ids}`).toBe(4);
  }, 60000);

  it("no source file counts ids from single create steps alone", () => {
    // The sketch-placement and extrude allocators live in renderer closures
    // this suite can't reach, so guard the pattern itself: every id must come
    // from maxItemId, which counts a Split's pieces too.
    const bad = [];
    const walk = (dir) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) {
          if (f !== "__tests__" && f !== "node_modules") walk(p);
        } else if (/\.(js|jsx)$/.test(f)) {
          const src = readFileSync(p, "utf8");
          if (/instruction\??\.item\??\.id\s*>\s*maxId/.test(src)) bad.push(p);
        }
      }
    };
    walk(join(__dirname, "..", ".."));
    expect(bad).toEqual([]);
  });
});
