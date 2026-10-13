// Folder / variables / material slice behavior against the REAL store: these
// slices had near-zero unit coverage although they own tree organization,
// formula inputs, and material persistence.

import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../../store";

const reset = () =>
  useStore.getState().loadDocument({
    version: 1,
    history: [
      {
        id: 0,
        label: "Scene created",
        itemId: null,
        instruction: { type: "scene_created" },
        hiddenIds: [],
      },
    ],
    activeHistoryId: null,
    variables: [],
  });

describe("folderSlice", () => {
  beforeEach(() => {
    reset();
    useStore.setState({ folders: [] });
  });

  it("adds, renames, toggles and reparents folders", () => {
    const s = () => useStore.getState();
    s().addFolder();
    s().addFolder();
    expect(s().folders.map((f) => f.id)).toEqual(["folder-1", "folder-2"]);

    s().renameFolder("folder-1", "  Parts  ");
    expect(s().folders[0].name).toBe("Parts");
    s().renameFolder("folder-1", "   "); // blank rename is ignored
    expect(s().folders[0].name).toBe("Parts");

    expect(s().folders[0].expanded).toBe(true);
    s().toggleFolderExpanded("folder-1");
    expect(s().folders[0].expanded).toBe(false);

    s().reparentFolder("folder-2", "folder-1");
    expect(s().folders.find((f) => f.id === "folder-2").parentId).toBe(
      "folder-1",
    );
    // Circular reparent refused: folder-1 under its own child.
    s().reparentFolder("folder-1", "folder-2");
    expect(s().folders.find((f) => f.id === "folder-1").parentId).toBe(null);
  });

  it("deleteFolder promotes contents (items + subfolders) to the parent", () => {
    const s = () => useStore.getState();
    s().addFolder(); // folder-1
    s().addFolder("folder-1"); // folder-2 inside folder-1
    s().addItem({
      id: 7,
      name: "Cube 7",
      type: "cube",
      children: [],
      parentId: null,
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    s().reparentItem?.(7, "folder-1");
    const item = () => s().items.find((i) => i.id === 7);
    if (item().parentId !== "folder-1")
      useStore.setState({
        items: s().items.map((i) =>
          i.id === 7 ? { ...i, parentId: "folder-1" } : i,
        ),
      });

    s().deleteFolder("folder-1");
    expect(s().folders.map((f) => f.id)).toEqual(["folder-2"]);
    expect(s().folders[0].parentId).toBe(null); // promoted
    expect(item().parentId).toBe(null); // promoted
    // The CREATE history entry was rewritten so the parent survives replay.
    const created = s().history.find(
      (h) => h.instruction?.type === "create" && h.instruction.item?.id === 7,
    );
    expect(created.instruction.item.parentId ?? null).toBe(null);
  });
});

describe("variablesSlice", () => {
  beforeEach(reset);

  // A variable change marks stale what it can reach: bodies from the first
  // step that names it onward.  It used to mark EVERY regenerator, whatever
  // it referenced (markCsgDirty on all items), so a body built before any use
  // of the variable was rebuilt for nothing; this asserted that.
  it("setVariables persists and dirties the regenerators it reaches", () => {
    const s = () => useStore.getState();
    const csg = (id, amount) => ({
      id,
      type: "csg",
      regenerator: { kind: "chamfer", amount, regeneratedAt: 0.1 },
      geometryData: { positions: [0, 0, 0], indices: [0] },
    });
    const create = (id, item) => ({
      id,
      label: "Chamfered",
      itemId: item.id,
      instruction: { type: "create", item },
      hiddenIds: [],
    });
    const before = csg(6, 0.2); // built before anything names "wall"
    const uses = csg(5, "wall");
    useStore.setState({
      items: [before, uses],
      history: [create(1, before), create(2, uses)],
    });
    s().setVariables([{ name: "wall", value: "2.5" }]);
    expect(s().variables).toEqual([{ name: "wall", value: "2.5" }]);
    const at = (id) =>
      s().items.find((i) => i.id === id).regenerator.regeneratedAt;
    expect(at(5), "the chamfer sized by wall").toBe("dirty");
    expect(at(6), "the chamfer before any use of wall").toBe(0.1);
    expect(s().history.map((e) => !!e.dirty)).toEqual([false, true]);
  });
});

describe("materialSlice", () => {
  beforeEach(reset);

  it("default material, per-item material, and presets round-trip", () => {
    const s = () => useStore.getState();
    s().setDefaultMaterial({ color: "#ff0000", roughness: 0.2 });
    expect(s().defaultMaterial.color).toBe("#ff0000");

    useStore.setState({
      items: [
        {
          id: 5,
          type: "cube",
          position: { x: 0, y: 0, z: 0 },
          children: [],
        },
      ],
    });
    s().setItemMaterial(5, { color: "#00ff00" });
    expect(s().items.find((i) => i.id === 5).material.color).toBe("#00ff00");

    s().addMaterialPreset("Grass", { color: "#00ff00" });
    expect(s().materialPresets.some((p) => p.name === "Grass")).toBe(true);
    const preset = s().materialPresets.find((p) => p.name === "Grass");
    s().removeMaterialPreset(preset.id);
    expect(s().materialPresets.some((p) => p.name === "Grass")).toBe(false);
  });
});

describe("sketchUndoSlice", () => {
  beforeEach(reset);

  it("undoSketch/redoSketch restore shapes and rewrite the create entry", () => {
    const s = () => useStore.getState();
    s().addItem({
      id: 9,
      name: "Sketch",
      type: "sketch",
      children: [],
      shapes: [],
      constraints: [],
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    });
    // Two edits through the sketch slice so the per-sketch undo stack fills.
    s().addSketchShape(9, { type: "line", x1: 0, y1: 0, x2: 1, y2: 0 });
    s().addSketchShape(9, { type: "line", x1: 1, y1: 0, x2: 1, y2: 1 });
    const shapes = () => s().items.find((i) => i.id === 9).shapes;
    expect(shapes().length).toBe(2);

    s().undoSketch(9);
    expect(shapes().length).toBe(1);
    // The CREATE entry mirrors the restored shapes (survives replay).
    const created = s().history.find(
      (h) => h.instruction?.type === "create" && h.instruction.item?.id === 9,
    );
    expect(created.instruction.item.shapes.length).toBe(1);

    s().redoSketch(9);
    expect(shapes().length).toBe(2);
  });
});
