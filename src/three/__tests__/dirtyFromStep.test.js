// An edit invalidates the timeline from the first step it reaches, never
// before it: a step only references what came before it.  The extrude edits
// used to mark EVERY entry dirty -- editing the last extrude of
// test-files/recalc-overload.pcad re-sewed its 14k-triangle import and re-ran
// every boolean and chamfer (five steps, 11.7 s measured) to rebuild nothing
// that could have changed.  Sketch edits marked no entry at all: a grown
// circle never reached the extrusion built on it.
import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

// Run a recalc, collecting the steps it rebuilds from its own log line.
async function rebuiltByRecalc() {
  const rebuilt = [];
  const log = console.log;
  console.log = (...a) => {
    const m = /recalc: rebuilding entry (\d+)/.exec(String(a[0]));
    if (m) rebuilt.push(Number(m[1]));
    else log(...a);
  };
  try {
    await recalculateTimeline();
  } finally {
    console.log = log;
  }
  return rebuilt;
}

const dirtyIndices = () =>
  useStore
    .getState()
    .history.map((e, i) => (e.dirty ? i : -1))
    .filter((i) => i >= 0);
const entryIndex = (id) =>
  useStore.getState().history.findIndex((e) => e.id === id);
const extentX = (g) => {
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < g.positions.length; i += 3) {
    mn = Math.min(mn, g.positions[i]);
    mx = Math.max(mx, g.positions[i]);
  }
  return mx - mn;
};

const loadOverload = async () => {
  useStore
    .getState()
    .loadDocument(
      JSON.parse(fs.readFileSync("test-files/recalc-overload.pcad", "utf8")),
    );
  await rebuiltByRecalc(); // settle whatever loading left stale
  // Entries with no geometry of their own (the scene, sketches, deletes) are
  // carried through the recalc with their flag as it was; start clean.
  useStore.setState({
    history: useStore.getState().history.map((e) => ({ ...e, dirty: false })),
  });
};

describe("an edit invalidates from the step it reaches", () => {
  it("editing the last extrude rebuilds nothing before it", async () => {
    await loadOverload();
    const ext = useStore.getState().items.find((i) => i.id === 17);
    useStore.getState().retargetExtrude(17, ext.profile, "7", 0);
    const own = entryIndex(23); // Extrude 17's step, the last
    expect(dirtyIndices()).toEqual([own]);
    // A plain extrude is drawn by the scene itself, so the recalc has nothing
    // to rebuild at all -- it used to rebuild five steps.
    expect(await rebuiltByRecalc()).toEqual([]);
  }, 120000);

  it("a sketch edit reaches the extrusion built on it, and nothing earlier", async () => {
    await loadOverload();
    useStore.getState().restoreToHistory(5); // Extruded 5's step, visible
    await rebuiltByRecalc();
    const before = extentX(
      useStore.getState().items.find((i) => i.id === 5).geometryData,
    );
    // Grow the two bosses' rings (circles 0-5 of Sketch 4) by 20 %.
    for (let i = 0; i < 6; i++) {
      const s = useStore.getState().items.find((it) => it.id === 4).shapes[i];
      useStore.getState().updateSketchShape(4, i, { ...s, r: s.r * 1.2 });
    }
    const sketchStep = entryIndex(4);
    expect(Math.min(...dirtyIndices())).toBe(sketchStep);
    const rebuilt = await rebuiltByRecalc();
    expect(
      rebuilt,
      "the import before the sketch is not rebuilt",
    ).not.toContain(1);
    expect(rebuilt).toContain(5);
    const after = extentX(
      useStore.getState().items.find((i) => i.id === 5).geometryData,
    );
    // The outer ring is 0.553 units in radius: 20 % more on each boss's far
    // side widens the pair by 2 x 0.11.
    expect(after - before, `extent ${before} -> ${after}`).toBeCloseTo(
      2 * 0.553 * 0.2,
      2,
    );
  }, 300000);

  it("a variable change starts at the first step that names it", () => {
    const O = { x: 0, y: 0, z: 0 };
    const square = (h) => [
      { x: -h, y: -h },
      { x: h, y: -h },
      { x: h, y: h },
      { x: -h, y: h },
    ];
    const extrude = (id, depth, x) => ({
      id,
      type: "extrude",
      name: `Extrude ${id}`,
      depth,
      position: { x, y: 0, z: 0 },
      rotation: O,
      scale: { x: 1, y: 1, z: 1 },
      profile: { polygon2D: square(1), holes: [], position: O, rotation: O },
    });
    const create = (id, item) => ({
      id,
      label: "Added",
      itemId: item.id,
      instruction: { type: "create", item },
      hiddenIds: [],
    });
    useStore.getState().loadDocument({
      history: [
        {
          id: 0,
          label: "Scene created",
          itemId: null,
          instruction: { type: "scene_created" },
          hiddenIds: [],
        },
        create(1, extrude(1, "5", -3)),
        create(2, extrude(2, "8", 0)),
        create(3, extrude(3, "Thick", 3)),
      ],
      activeHistoryId: null,
      variables: [
        { name: "Thick", formula: "4" },
        { name: "Base", formula: "2" },
      ],
    });
    useStore.setState({
      history: useStore.getState().history.map((e) => ({ ...e, dirty: false })),
    });
    useStore.getState().setVariables([
      { name: "Thick", formula: "6" },
      { name: "Base", formula: "2" },
    ]);
    expect(dirtyIndices()).toEqual([3]);
    // An unused variable changing reaches no step at all.
    useStore.setState({
      history: useStore.getState().history.map((e) => ({ ...e, dirty: false })),
    });
    useStore.getState().setVariables([
      { name: "Thick", formula: "6" },
      { name: "Base", formula: "9" },
    ]);
    expect(dirtyIndices()).toEqual([]);
  });

  it("a variable computed from a changed one carries the change", () => {
    useStore.setState({
      history: useStore.getState().history.map((e) => ({ ...e, dirty: false })),
    });
    // Thick := Base * 3: changing Base reaches the step that names Thick.
    useStore.getState().setVariables([
      { name: "Thick", formula: "Base * 3" },
      { name: "Base", formula: "9" },
    ]);
    useStore.setState({
      history: useStore.getState().history.map((e) => ({ ...e, dirty: false })),
    });
    useStore.getState().setVariables([
      { name: "Thick", formula: "Base * 3" },
      { name: "Base", formula: "1" },
    ]);
    expect(dirtyIndices()).toEqual([3]);
  });
});
