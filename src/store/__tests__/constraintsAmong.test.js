// What a sketch copy carries.  Copy used to take only coincident joins, so a
// pasted cog or text lost the lock that makes it one editable shape: its
// editor would no longer open on it, and it stopped being a primitive at all.
import { describe, it, expect } from "vitest";
import { constraintsAmong } from "../internals.js";

const TYPES = new Set(["coincident", "cog", "text"]);

describe("constraintsAmong", () => {
  it("carries a cog's and a text's lock, renumbered into the copy", () => {
    const constraints = [
      { type: "cog", shapeIdx: 4 },
      { type: "text", shapeIdx: 7 },
    ];
    expect(constraintsAmong(constraints, [7, 4], TYPES)).toEqual([
      { type: "cog", shapeIdx: 1 },
      { type: "text", shapeIdx: 0 },
    ]);
  });

  it("keeps a join between two copied shapes", () => {
    const c = {
      type: "coincident",
      shapeAIdx: 2,
      pointA: "end",
      shapeBIdx: 3,
      pointB: "start",
    };
    expect(constraintsAmong([c], [2, 3], TYPES)).toEqual([
      { ...c, shapeAIdx: 0, shapeBIdx: 1 },
    ]);
  });

  it("leaves behind anything reaching a shape outside the copy", () => {
    const c = { type: "coincident", shapeAIdx: 2, shapeBIdx: 9 };
    expect(constraintsAmong([c], [2, 3], TYPES)).toEqual([]);
  });

  it("carries only the kinds asked for", () => {
    const h = { type: "horizontal", shapeIdx: 2 };
    expect(constraintsAmong([h], [2], TYPES)).toEqual([]);
  });
});
