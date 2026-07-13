// Texture op end-to-end at the store/regen level: the regenerator rebuilds
// the displaced mesh from its recipe, honours a live source change, and the
// in-place edit flow (begin/commit/undo) mirrors emboss.

import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { regenerateItemsForResolution } from "../regenerateItems.js";
import { setHeightfieldDecoder } from "../textureImage.js";

beforeAll(async () => {
  await ensureOcc();
  // Node has no Image/canvas — decode every "dataURL" as a synthetic 8×8
  // all-white heightfield.
  setHeightfieldDecoder(async () => ({
    width: 8,
    height: 8,
    data: new Float32Array(64).fill(1),
  }));
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };
const cube = { id: 5, type: "cube", position: O, rotation: O, scale: S };

// The +y face of the 2×2×2 cube as the pick-time region.
const topFaceTris = [
  -1, 1, 1, 1, 1, 1, 1, 1, -1, -1, 1, 1, 1, 1, -1, -1, 1, -1,
];

const regen = (over = {}) => ({
  kind: "texture",
  source: { ...cube },
  face: { nx: 0, ny: 1, nz: 0, cx: 0, cy: 1, cz: 0 },
  faceSet: null,
  faceTris: topFaceTris,
  faceCount: 1,
  params: {
    png: "data:image/png;base64,stub",
    pngName: "stub.png",
    projection: "center",
    offsetHMm: 0,
    offsetVMm: 0,
    rotationDeg: 0,
    sizeMm: 100, // covers the whole 20 mm face
    depthMm: 2,
    resolutionMm: 3,
    wrap: false,
  },
  centerOffset: { cx: 0, cy: 0.1, cz: 0 },
  basePosition: { x: 0, y: 0, z: 0 },
  sourceCenterOffset: { cx: 0, cy: 0, cz: 0 },
  regeneratedAt: "dirty",
  ...over,
});

describe("texture regen", () => {
  it("rebuilds the displaced mesh from the recipe", async () => {
    const item = {
      ...cube,
      type: "csg",
      regenerator: regen(),
      geometryData: null,
    };
    const out = await regenerateItemsForResolution([item], 0.1, null, null);
    const rebuilt = out.find((i) => i.id === 5);
    expect(rebuilt.geometryData?.positions?.length).toBeGreaterThan(0);
    expect(rebuilt.regenerator.regeneratedAt).toBe(0.1);
    // The displaced top sits 0.2 scene units (2 mm) above the original +1;
    // the mesh is bbox-centred, so total height = 2.2.
    const p = rebuilt.geometryData.positions;
    let minY = Infinity,
      maxY = -Infinity;
    for (let i = 1; i < p.length; i += 3) {
      minY = Math.min(minY, p[i]);
      maxY = Math.max(maxY, p[i]);
    }
    expect(maxY - minY).toBeCloseTo(2.2, 2);
  }, 60000);

  it("negative depth recesses instead", async () => {
    const item = {
      ...cube,
      type: "csg",
      regenerator: regen({
        params: { ...regen().params, depthMm: -2 },
      }),
      geometryData: null,
    };
    const out = await regenerateItemsForResolution([item], 0.1, null, null);
    const p = out.find((i) => i.id === 5).geometryData.positions;
    let minY = Infinity,
      maxY = -Infinity;
    for (let i = 1; i < p.length; i += 3) {
      minY = Math.min(minY, p[i]);
      maxY = Math.max(maxY, p[i]);
    }
    // Interior recessed, boundary ring still at the original top: height 2.
    expect(maxY - minY).toBeCloseTo(2, 2);
  }, 60000);
});

describe("texture timeline edit", () => {
  const geom = { positions: [0, 0, 0], normals: null, indices: [0] };
  const patches = (depthMm) => ({
    type: "csg",
    position: { x: 0, y: 0, z: 0 },
    geometryData: geom,
    regenerator: regen({ params: { ...regen().params, depthMm } }),
  });

  const load = () => {
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
        {
          id: 1,
          label: "Added",
          itemId: 5,
          instruction: { type: "create", item: { ...cube } },
          hiddenIds: [],
        },
        {
          id: 2,
          label: "Texture",
          itemId: 5,
          instruction: { type: "modify", itemId: 5, patches: patches(2) },
          hiddenIds: [],
        },
      ],
      activeHistoryId: null,
      variables: [],
    });
  };

  it("beginTextureEdit views the pre-texture step with the recipe armed", () => {
    load();
    useStore.getState().beginTextureEdit(2);
    const s = useStore.getState();
    expect(s.textureTool?.editEntryId).toBe(2);
    expect(s.activeHistoryId).toBe(1); // previous step on screen
    expect(s.items.find((i) => i.id === 5)?.type).toBe("cube");
    expect(s.textureTool.params.depthMm).toBe(2);
    expect(s.textureTool.faceTris).toEqual(topFaceTris);
  });

  it("updateTextureEntry updates in place, lands on the entry, and undoes", () => {
    load();
    useStore.getState().restoreToHistory(1);
    const stepsBefore = useStore.getState().history.length;
    useStore.getState().updateTextureEntry(2, patches(5));
    let s = useStore.getState();
    expect(s.history.length).toBe(stepsBefore);
    expect(
      s.history.find((h) => h.id === 2).instruction.patches.regenerator.params
        .depthMm,
    ).toBe(5);
    expect(s.activeHistoryId).toBe(null); // entry is the tip

    useStore.getState().undo();
    s = useStore.getState();
    expect(
      s.history.find((h) => h.id === 2).instruction.patches.regenerator.params
        .depthMm,
    ).toBe(2);
  });

  it("cancelTextureTool restores the edited entry", () => {
    load();
    useStore.getState().beginTextureEdit(2);
    expect(useStore.getState().activeHistoryId).toBe(1);
    useStore.getState().cancelTextureTool();
    const s = useStore.getState();
    expect(s.textureTool).toBe(null);
    expect(s.activeHistoryId).toBe(null); // entry 2 is the tip
  });
});
