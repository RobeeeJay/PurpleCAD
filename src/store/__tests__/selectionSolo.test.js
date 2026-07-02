// Cmd/Ctrl-click "solo" on the 3D selection-type widget: isolate one type, then
// a second solo-click restores the prior set.

import { describe, it, expect } from "vitest";
import { create } from "zustand";
import { createUiSlice, uiInitial } from "../uiSlice.js";

const makeStore = () =>
  create((set) => ({ ...uiInitial, ...createUiSlice(set) }));
const sel = (s) => {
  const g = s.getState();
  return {
    object: g.selObject,
    face: g.selFace,
    edge: g.selEdge,
    point: g.selPoint,
  };
};

describe("soloSelType", () => {
  it("isolates a type and restores the prior set on a second solo-click", () => {
    const s = makeStore();
    s.getState().toggleSelFace(); // object off, face on
    s.getState().toggleSelPoint(); // + point on
    expect(sel(s)).toEqual({
      object: false,
      face: true,
      edge: false,
      point: true,
    });

    s.getState().soloSelType("face"); // isolate face
    expect(sel(s)).toEqual({
      object: false,
      face: true,
      edge: false,
      point: false,
    });

    s.getState().soloSelType("face"); // restore the prior set
    expect(sel(s)).toEqual({
      object: false,
      face: true,
      edge: false,
      point: true,
    });
  });

  it("switching solos keeps the original restore point", () => {
    const s = makeStore();
    s.getState().toggleSelFace();
    s.getState().toggleSelEdge(); // face + edge on
    s.getState().soloSelType("face"); // isolate face (saves face+edge)
    s.getState().soloSelType("edge"); // isolate edge (keeps the saved face+edge)
    expect(sel(s)).toEqual({
      object: false,
      face: false,
      edge: true,
      point: false,
    });
    s.getState().soloSelType("edge"); // restore the original face+edge
    expect(sel(s)).toEqual({
      object: false,
      face: true,
      edge: true,
      point: false,
    });
  });

  it("a normal toggle clears the saved solo state", () => {
    const s = makeStore();
    s.getState().toggleSelFace();
    s.getState().toggleSelPoint(); // face + point
    s.getState().soloSelType("face"); // isolate (saved = face+point)
    s.getState().toggleSelEdge(); // normal toggle → clears the saved set
    // Now isolated-looking? face on, edge on. soloSelType("face") shouldn't
    // restore the old face+point — it re-isolates instead.
    s.getState().soloSelType("face");
    expect(sel(s)).toEqual({
      object: false,
      face: true,
      edge: false,
      point: false,
    });
  });
});
