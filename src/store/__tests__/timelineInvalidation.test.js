// Phase 0 of the JIT timeline: the store mutation actions must set per-entry
// `dirty` flags following the spec's forward-invalidation rules —
//   edit E          → E and every later entry dirty
//   delete E        → every entry after the deleted one dirty
//   insert at P      → the new entry and every later entry dirty
//   resolution toggle → the whole timeline dirty

import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { replayUpTo } from "../internals.js";
import { createHistorySlice } from "../historySlice.js";
import { createUiSlice, uiInitial } from "../uiSlice.js";

const box = {
  id: 5,
  type: "cube",
  name: "Box 1",
  children: [],
  parentId: null,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  dimensions: { width: 2, height: 2, depth: 2 },
};
const geom = { positions: [0, 0, 0], normals: null, indices: [0] };
const csgPatches = (kind, extra) => ({
  type: "csg",
  position: { x: 0, y: 0, z: 0 },
  geometryData: geom,
  regenerator: { kind, source: box, regeneratedAt: 0.5, ...extra },
});

const history = () => [
  { id: "h1", instruction: { type: "create", item: box } },
  {
    id: "h2",
    instruction: {
      type: "modify",
      itemId: 5,
      patches: csgPatches("chamfer", {
        subGeo: { edges: [], faces: [{ nx: 0, ny: 1, nz: 0 }] },
        amount: 0.1,
        segments: 1,
      }),
    },
  },
  {
    id: "h3",
    instruction: {
      type: "modify",
      itemId: 5,
      patches: csgPatches("emboss", {
        source: { ...box, ...csgPatches("chamfer", { amount: 0.1 }) },
      }),
    },
  },
];

const makeStore = () =>
  create((set) => ({
    ...uiInitial,
    items: replayUpTo(history(), 2),
    history: history(),
    activeHistoryId: null,
    undoStack: [],
    redoStack: [],
    ...createUiSlice(set),
    ...createHistorySlice(set),
  }));

const dirty = (s) => s.getState().history.map((e) => !!e.dirty);

describe("timeline forward invalidation", () => {
  it("editing an entry invalidates it via its payload and dirties later entries", () => {
    const s = makeStore();
    s.getState().updateChamferParams("h2", { amount: 0.42 });
    // The edited entry is NOT flag-dirtied (flagging it made the recalc re-run
    // the op Confirm had just computed — every edit ran its OCC op twice).  Its
    // own payload invalidates it instead: a param edit stamps
    // regeneratedAt:"dirty" + clears geometryData, which fails entryCacheValid.
    // Only entries AFTER it get the flag.
    expect(dirty(s)).toEqual([false, false, true]);
    const h2 = s.getState().history.find((e) => e.id === "h2");
    expect(h2.instruction.patches.regenerator.regeneratedAt).toBe("dirty");
    expect(h2.instruction.patches.geometryData).toBeNull();
  });

  it("deleting an entry dirties every entry after it", () => {
    const s = makeStore();
    s.getState().deleteHistoryEntry("h2");
    // h2 gone; the entry that followed (h3) is dirty, the base create stays clean.
    expect(dirty(s)).toEqual([false, true]);
  });

  it("inserting a modify (bevel) mid-timeline dirties only the later entries", () => {
    const s = makeStore();
    // Park on h2 and insert a shell — it lands between h2 and h3.  The new step
    // carries the geometry its tool just computed (clean); only h3 (which existed
    // already) must rebuild on top of it.
    s.setState({ activeHistoryId: "h2" });
    s.getState().modifyItem(
      5,
      csgPatches("shell", { thickness: 0.1 }),
      "Shelled",
    );
    // Order: h1, h2, <new>, h3 → the new step stays clean; only h3 is dirty.
    expect(dirty(s)).toEqual([false, false, false, true]);
  });

  it("inserting a modify before a later same-item op relinks its source", () => {
    const s = makeStore();
    // Park on the chamfer (h2) and insert a shell before the emboss (h3).  The
    // emboss must now build on the shell (the newly inserted result), not its
    // stale pre-insert snapshot — otherwise its preview/geometry omits the shell.
    s.setState({ activeHistoryId: "h2" });
    s.getState().modifyItem(
      5,
      csgPatches("shell", { thickness: 0.1 }),
      "Shelled",
    );
    const emb = s.getState().history.find((e) => e.id === "h3");
    expect(emb.instruction.patches.regenerator.source.regenerator.kind).toBe(
      "shell",
    );
  });

  it("an in-place depth/dimension edit dirties the whole timeline (JIT recalc reruns regen)", () => {
    const s = makeStore();
    // Edits that rewrite a create entry + markCsgDirty the LIVE items (extrude
    // depth, group depth, retarget, and setVariables) must ALSO dirty the history
    // entries — the JIT recalc reads entry.dirty, not the live items, so it would
    // otherwise skip every step as clean and keep stale downstream geometry.
    s.getState().setExtrudeDepth(5, 3);
    expect(dirty(s)).toEqual([true, true, true]);
  });

  // A new Resolution re-tessellates every step: the one edit that marks the
  // whole timeline.  Committing the value it already has changes nothing.
  it("a new resolution dirties the whole timeline; the same one nothing", () => {
    const s = makeStore();
    s.getState().setResolutionMm(s.getState().resolutionMm);
    expect(dirty(s)).toEqual([false, false, false]);
    s.getState().setResolutionMm(0.02);
    expect(dirty(s)).toEqual([true, true, true]);
  });
});
