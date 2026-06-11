// Regression: retargeting the extrude that ANCHORS a union (inputIds[0]) must
// shift that union's re-localisation anchor (originalCenter / position) by the
// same delta — see shiftUnionAnchorForRetarget.  Without this, buildItemShapeLocal
// re-localises the rebuilt union by the STALE anchor, shifting the anchor
// extrude's contribution inside the union's local frame and dragging any
// chamfer/fillet `subGeo` selections (and the rendered result) off the shape.

import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { replayUpTo } from "../internals.js";
import { createHistorySlice } from "../historySlice.js";

const profileAt = (cx) => ({
  sketchId: 1,
  profileCentroid: { x: cx, y: 0 },
  polygon2D: [
    { x: cx - 1, y: -1 },
    { x: cx + 1, y: -1 },
    { x: cx + 1, y: 1 },
    { x: cx - 1, y: 1 },
  ],
  holes: [],
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  normalWorld: { x: 0, y: 0, z: 1 },
});

const extrude = (id, cx) => ({
  id,
  type: "extrude",
  name: `Extrude ${id}`,
  children: [],
  parentId: null,
  depth: 2,
  visible: false,
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  profile: profileAt(cx),
});

const unionRegen = () => ({
  kind: "boolean",
  op: "union",
  inputIds: [2, 3],
  originalCenter: { x: 0, y: 0, z: 0 },
  regeneratedAt: 0.5,
});

const unionItem = () => ({
  id: 4,
  type: "csg",
  position: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  rotation: { x: 0, y: 0, z: 0 },
  geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
  regenerator: unionRegen(),
});

const history = [
  {
    id: "h1",
    instruction: {
      type: "create",
      item: { id: 1, type: "sketch", shapes: [] },
    },
  },
  { id: "h2", instruction: { type: "create", item: extrude(2, 0) } },
  { id: "h3", instruction: { type: "create", item: extrude(3, 3) } },
  { id: "h4", instruction: { type: "create", item: unionItem() } },
  {
    id: "h5",
    instruction: {
      type: "modify",
      itemId: 4,
      patches: {
        type: "csg",
        position: { x: 0, y: 0, z: 0 },
        regenerator: {
          kind: "chamfer",
          source: unionItem(),
          subGeo: { edges: [], faces: [{ nx: 0, ny: 0, nz: 1 }] },
          amount: 0.2,
          segments: 2,
          regeneratedAt: 0.5,
        },
        geometryData: { positions: [0, 0, 0], normals: null, indices: [0] },
      },
    },
  },
];

const makeStore = () =>
  create((set) => ({
    items: replayUpTo(history, history.length - 1),
    history,
    activeHistoryId: null,
    undoStack: [],
    redoStack: [],
    ...createHistorySlice(set),
  }));

describe("retargetExtrude shifts a union's anchor when the anchor input moves", () => {
  it("shifts originalCenter/position by the anchor's centroid delta", () => {
    const useStore = makeStore();
    // Move the anchor extrude (id 2, inputIds[0]) from cx=0 to cx=5 — a +5 delta.
    useStore.getState().retargetExtrude(2, profileAt(5), 2);

    const fillet = useStore.getState().items.find((i) => i.id === 4);
    expect(fillet.position).toEqual({ x: 5, y: 0, z: 0 });
    expect(fillet.regenerator.source.position).toEqual({ x: 5, y: 0, z: 0 });
    expect(fillet.regenerator.source.regenerator.originalCenter).toEqual({
      x: 5,
      y: 0,
      z: 0,
    });

    // The history's frozen union create-entry and the chamfer's source
    // snapshot both carry the shifted anchor too.
    const unionEntry = useStore
      .getState()
      .history.find(
        (h) => h.instruction.type === "create" && h.instruction.item?.id === 4,
      );
    expect(unionEntry.instruction.item.regenerator.originalCenter).toEqual({
      x: 5,
      y: 0,
      z: 0,
    });
  });

  it("leaves the anchor untouched when a non-anchor input is retargeted", () => {
    const useStore = makeStore();
    // Move the second input (id 3, NOT inputIds[0]) — the union's anchor
    // (input 2's position) hasn't moved, so originalCenter must stay put.
    useStore.getState().retargetExtrude(3, profileAt(8), 2);

    const fillet = useStore.getState().items.find((i) => i.id === 4);
    expect(fillet.position).toEqual({ x: 0, y: 0, z: 0 });
    expect(fillet.regenerator.source.regenerator.originalCenter).toEqual({
      x: 0,
      y: 0,
      z: 0,
    });
  });
});
