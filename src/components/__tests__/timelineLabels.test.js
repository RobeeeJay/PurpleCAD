// What a timeline step is called.  A split's pieces are made in one createGroup
// step, which the timeline used to describe by count as though it were a
// multi-area extrude: "Split 2 extrusions", for halves of a cube.
import { describe, it, expect } from "vitest";
import { getDisplayLabel } from "../timelineLabels.js";

const created = (id, name, type = "cube") => ({
  id: 1,
  label: "Added",
  itemId: id,
  instruction: { type: "create", item: { id, name, type } },
});
const group = (label, items, extra = {}) => ({
  id: 2,
  label,
  itemId: items[0].id,
  instruction: { type: "createGroup", items, ...extra },
});

describe("timeline step labels", () => {
  it("names a split by the body it cut", () => {
    const history = [
      created(10, "Block"),
      group(
        "Split",
        [
          { id: 11, name: "Block (1)", type: "csg" },
          { id: 12, name: "Block (2)", type: "csg" },
        ],
        { splitFrom: 10 },
      ),
    ];
    expect(getDisplayLabel(history[1], history)).toBe("Split Block");
  });

  it("still counts a multi-area extrude's prisms as extrusions", () => {
    const e = group("Added", [
      { id: 20, name: "Extrude 20", type: "extrude" },
      { id: 21, name: "Extrude 21", type: "extrude" },
      { id: 22, name: "Extrude 22", type: "extrude" },
    ]);
    expect(getDisplayLabel(e, [e])).toBe("Added 3 extrusions");
  });

  it("calls a group of anything else bodies", () => {
    // A split saved before it recorded its source has no name to give.
    const e = group("Split", [
      { id: 11, name: "Block (1)", type: "csg" },
      { id: 12, name: "Block (2)", type: "csg" },
    ]);
    expect(getDisplayLabel(e, [e])).toBe("Split 2 bodies");
  });

  it('names a group of one by its item, not "1 extrusions"', () => {
    const e = group("Extruded", [
      { id: 4, name: "Extrude 4", type: "extrude" },
    ]);
    expect(getDisplayLabel(e, [e])).toBe("Extruded Extrude 4");
  });

  it("names an ordinary step by its item", () => {
    const h = [created(10, "Block")];
    expect(getDisplayLabel(h[0], h)).toBe("Added Block");
  });
});
