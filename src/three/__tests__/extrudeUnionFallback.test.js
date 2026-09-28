// An extrude that starts on a body is fused into it.  When OCC REFUSES that
// body -- an imported mesh too dense to turn into a solid for a boolean -- the
// fuse throws rather than coming back empty, and the runner used to catch that
// and only log it.  Its prisms live only inside the union's recipe until it is
// committed, so nothing was created at all: a backward extrude from a sketch on
// an imported STL produced no geometry and no message.
import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { runExtrudeUnion } from "../cameraControls/extrudeBoolean.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };

// A finely tessellated sphere, standing in for an imported STL: every facet is
// curved, so coplanar merging can't reduce it -- its face count stays its
// triangle count, which is what the boolean size limits measure.
const denseSphere = (r = 3, seg = 80) => {
  const positions = [];
  const indices = [];
  for (let i = 0; i <= seg; i++) {
    const v = (i / seg) * Math.PI;
    for (let j = 0; j <= seg; j++) {
      const u = (j / seg) * 2 * Math.PI;
      positions.push(
        r * Math.sin(v) * Math.cos(u),
        r * Math.cos(v),
        r * Math.sin(v) * Math.sin(u),
      );
    }
  }
  for (let i = 0; i < seg; i++)
    for (let j = 0; j < seg; j++) {
      const a = i * (seg + 1) + j;
      const b = a + seg + 1;
      if (i !== 0) indices.push(a, b, a + 1);
      if (i !== seg - 1) indices.push(a + 1, b, b + 1);
    }
  return { positions, indices };
};

const boss = (id) => ({
  id,
  type: "extrude",
  name: `boss ${id}`,
  children: [],
  profile: {
    type: "sketchLoop",
    sketchId: null,
    polygon2D: [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
    ],
    holes: [],
    position: O,
    rotation: O,
    normalWorld: { x: 0, y: 0, z: 1 },
  },
  depth: "-20",
  position: O,
  rotation: O,
  scale: S,
});

const docWithMeshHost = (seg) => ({
  version: 1,
  activeHistoryId: null,
  variables: [],
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
      instruction: {
        type: "create",
        item: {
          id: 5,
          name: "Imported part (STL)",
          type: "csg",
          children: [],
          parentId: null,
          position: O,
          rotation: O,
          scale: S,
          geometryData: denseSphere(3, seg),
        },
      },
      hiddenIds: [],
    },
  ],
});

describe("an extrude OCC can't fuse into its host", () => {
  // Over the 50,000-triangle limit (160 segments: 50,880 triangles), which OCC
  // refuses before it even sews.  This used an ~12.6k-triangle mesh when the
  // face cap was 5000; that mesh now fuses (below).
  it("is added as a separate body, and says why", async () => {
    useStore.getState().loadDocument(docWithMeshHost(160));
    useStore.setState({ notification: null });
    await runExtrudeUnion([boss(101)], [5], 200);
    const s = useStore.getState();

    // The fuse really was refused by OCC -- this is the real error path, not a
    // stand-in -- and the user is told, not just the console.
    expect(s.notification ?? "", "notification").toMatch(
      /added as a separate body/,
    );
    expect(s.notification).toMatch(/too detailed \(50880 triangles\)/);
    // The extrusion exists...
    expect(s.items.find((i) => i.id === 101)?.type, "the prism").toBe(
      "extrude",
    );
    // ...and the body it couldn't merge with is left as it was.
    expect(
      s.items.find((i) => i.id === 5),
      "the host",
    ).toBeTruthy();
    expect(
      s.items.find((i) => i.id === 200),
      "no fused result",
    ).toBeFalsy();
    expect(s.history.at(-1).label).toBe("Extruded");
  }, 120000);

  // The limit that refused an ordinary imported part: an STL of ~14.6k faces
  // was over the old 5000-face cap, so an extrude from a sketch on it could
  // never merge.  86 segments gives 14,620 curved triangles.
  it("fuses into an imported mesh the size of a real part", async () => {
    useStore.getState().loadDocument(docWithMeshHost(86));
    useStore.setState({ notification: null });
    await runExtrudeUnion([boss(101)], [5], 200);
    const s = useStore.getState();
    expect(s.notification, "no fallback message").toBeNull();
    const fused = s.items.find((i) => i.id === 200);
    expect(fused?.type, "the fused body").toBe("csg");
    expect(fused.regenerator.inputIds).toEqual([5]);
  }, 120000);
});
