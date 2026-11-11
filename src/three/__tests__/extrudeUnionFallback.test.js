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
import { commitSimplify } from "../cameraControls/simplify.js";
import { budget } from "../../testBudget.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };

// A finely tessellated sphere, standing in for an imported STL: every facet is
// curved, so coplanar merging can't reduce it -- its face count stays its
// triangle count, which is what the boolean size limits measure.  Closed, as a
// good STL is: the seam column and the poles are shared vertices, not copies
// a rounding error apart (which the open-mesh check rightly reports as holes).
// `open` leaves out the first band of triangles below the north pole.
const denseSphere = (r = 3, seg = 80, { open = false } = {}) => {
  const positions = [0, r, 0];
  for (let i = 1; i < seg; i++) {
    const v = (i / seg) * Math.PI;
    for (let j = 0; j < seg; j++) {
      const u = (j / seg) * 2 * Math.PI;
      positions.push(
        r * Math.sin(v) * Math.cos(u),
        r * Math.cos(v),
        r * Math.sin(v) * Math.sin(u),
      );
    }
  }
  positions.push(0, -r, 0);
  const south = positions.length / 3 - 1;
  const at = (i, j) =>
    i === 0 ? 0 : i === seg ? south : 1 + (i - 1) * seg + (j % seg);
  const indices = [];
  for (let i = open ? 1 : 0; i < seg; i++)
    for (let j = 0; j < seg; j++) {
      const a = at(i, j);
      const b = at(i + 1, j);
      if (i !== 0) indices.push(a, b, at(i, j + 1));
      if (i !== seg - 1) indices.push(at(i, j + 1), b, at(i + 1, j + 1));
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

const docWithMeshHost = (seg, shape) => ({
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
          geometryData: denseSphere(3, seg, shape),
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
    // The message offers to simplify that mesh to fit, a tenth under the
    // 50,000-triangle limit.
    expect(s.notificationAction).toEqual({
      kind: "simplifyToFit",
      itemId: 5,
      targetTriangles: 45000,
    });
  }, 120000);

  // The offer must actually fix it: simplified to the preset, the same
  // extrude merges.
  it(
    "merges once the mesh is simplified to fit",
    async () => {
      useStore.getState().loadDocument(docWithMeshHost(160));
      useStore.setState({ notification: null });
      await runExtrudeUnion([boss(101)], [5], 200);
      const { itemId, targetTriangles } =
        useStore.getState().notificationAction;
      const host = useStore.getState().items.find((i) => i.id === itemId);
      const ok = await commitSimplify({
        item: host,
        params: { mode: "triangles", toleranceMm: 0.05, targetTriangles },
        printPrecision: 0.1,
      });
      expect(ok).toBe(true);
      useStore.setState({ notification: null, notificationAction: null });
      await runExtrudeUnion([boss(102)], [5], 201);
      const s = useStore.getState();
      expect(s.notification, "no fallback message").toBeNull();
      expect(s.items.find((i) => i.id === 201)?.type, "the fused body").toBe(
        "csg",
      );
    },
    budget(240000),
  );

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

  // A warning, not a refusal: the fuse goes ahead, but where the surface is
  // open the result can have holes, and the user should hear that.
  it("fuses into an open mesh and warns it may have holes", async () => {
    useStore.getState().loadDocument(docWithMeshHost(40, { open: true }));
    useStore.setState({ notification: null });
    await runExtrudeUnion([boss(101)], [5], 200);
    const s = useStore.getState();
    expect(s.notification).toBe(
      "Imported part (STL) (40 open edges) isn't a closed solid, so this result may have holes.",
    );
    expect(s.items.find((i) => i.id === 200)?.type, "the fused body").toBe(
      "csg",
    );
  }, 120000);
});
