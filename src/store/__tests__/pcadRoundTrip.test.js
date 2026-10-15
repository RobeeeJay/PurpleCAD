// .pcad save/load fidelity.  Loading normalises a document once (emboss frame
// backfill, orphan flags); after that, save → load → save must be a fixed
// point — any further mutation means a load path is silently rewriting user
// documents (the bug class behind "reverts to an earlier state" reports).

import { describe, it, expect } from "vitest";
import fs from "fs";
import { useStore } from "../../store";

// Serialize exactly the way DocumentSection.handleSave does.
const save = () => {
  const s = useStore.getState();
  return JSON.stringify(
    {
      version: 1,
      history: s.history,
      activeHistoryId: s.activeHistoryId,
      variables: s.variables,
      folders: s.folders,
    },
    null,
    2,
  );
};

const FIXTURES = [
  "test-files/failing-recalculate-scene.pcad",
  "test-files/reorder-timeline-before.pcad",
  "test-files/high-quality-chamfer-fail.pcad",
];

describe("pcad round-trip", () => {
  for (const file of FIXTURES) {
    it(`${file} is a fixed point after one load`, () => {
      const original = JSON.parse(fs.readFileSync(file, "utf8"));
      useStore.getState().loadDocument(original);
      const first = save();

      useStore.getState().loadDocument(JSON.parse(first));
      const second = save();
      expect(second).toBe(first);

      // And the normalisation didn't change the structural content: same
      // entries, same instruction types, same active step.
      const a = JSON.parse(first);
      expect(a.history.map((h) => h.id)).toEqual(
        original.history.map((h) => h.id),
      );
      expect(a.history.map((h) => h.instruction?.type)).toEqual(
        original.history.map((h) => h.instruction?.type),
      );
      expect(a.activeHistoryId).toBe(original.activeHistoryId ?? null);
    });
  }
});

describe("components in a .pcad", () => {
  const base = () =>
    JSON.parse(
      fs.readFileSync("test-files/reorder-timeline-before.pcad", "utf8"),
    );

  it("are saved and come back on load, with their motion", () => {
    const doc = base();
    doc.folders = [
      {
        id: "folder-1",
        name: "Lid",
        parentId: null,
        expanded: true,
        motion: {
          type: "rotation",
          axis: { origin: { x: 0, y: 1, z: 0 }, dir: { x: 1, y: 0, z: 0 } },
          positive: "90",
          negative: "0",
          speed: "45",
          detectCollisions: true,
        },
      },
    ];
    useStore.getState().loadDocument(doc);
    expect(useStore.getState().folders).toEqual(doc.folders);
    const saved = JSON.parse(save());
    expect(saved.folders).toEqual(doc.folders);
  });

  it("a file saved before components were written into it loads with none", () => {
    const doc = base();
    delete doc.folders;
    useStore.getState().loadDocument(doc);
    expect(useStore.getState().folders).toEqual([]);
  });
});
