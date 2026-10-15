// A project saved before profiles recorded their exact curves builds faceted
// bodies, and keeps doing so until it is recalculated in full: then every
// profile takes its live curves and the bodies rebuild from true arcs.  Saved
// selections follow: a facet's face name (`side5`) and edge name (`side5|top`)
// now find the curved face and rim that facet became.  Where a selection has
// no counterpart -- a chamfer on the seam between two facets -- the step would
// fail, so the profiles under it are pinned back to their facets and the
// timeline is rebuilt as it was.
import { describe, it, expect, beforeAll } from "vitest";
import { ensureOcc } from "../occ/init.js";
import { useStore } from "../../store";
import { recalculateTimeline } from "../regenerateOrchestrator.js";
import * as occClient from "../occClient.js";
import { ops } from "../occOps.js";
import {
  upgradeProfileCurves,
  pinFacetedProfiles,
} from "../profileBackfill.js";
import { regionsWithShapes, withWinding } from "../sceneObjects/closedLoops.js";

beforeAll(async () => {
  await ensureOcc();
}, 60000);

const O = { x: 0, y: 0, z: 0 };
const S = { x: 1, y: 1, z: 1 };
const SHAPES = [{ type: "circle", cx: 0, cy: 0, r: 1 }];
const sketch = {
  id: 1,
  name: "Sketch",
  type: "sketch",
  shapes: SHAPES,
  position: O,
  rotation: O,
  scale: S,
  children: [],
  parentId: null,
};
// A profile as one was saved before exact curves: no curves2D.
const oldProfile = () => {
  const [g] = regionsWithShapes(SHAPES, 32, 0.05);
  return {
    type: "sketchLoop",
    sketchId: 1,
    textShapeIdx: null,
    profileCentroid: { x: 0.2, y: 0.1 },
    polygon2D: g.polygon,
    holes: [],
    loopShapes: g.loopShapes,
    position: O,
    rotation: O,
    normalWorld: { x: 0, y: 0, z: 1 },
  };
};
const history = (profiles) =>
  profiles.map((profile, i) => ({
    id: i + 1,
    instruction: {
      type: "create",
      item: { id: 10 + i, type: "extrude", profile },
    },
  }));
const createSketch = { id: 0, instruction: { type: "create", item: sketch } };

describe("upgrading saved profiles", () => {
  it("gives every copy of a profile the same live curves, with its polygon", () => {
    const p = oldProfile();
    const h = [
      createSketch,
      ...history([p]),
      // A chamfer's frozen copy of the same extrude.
      {
        id: 9,
        instruction: {
          type: "modify",
          itemId: 10,
          patches: { regenerator: { kind: "chamfer", source: { profile: p } } },
        },
      },
    ];
    const up = upgradeProfileCurves(h, 0.05);
    const own = up[1].instruction.item.profile;
    const copy = up[2].instruction.patches.regenerator.source.profile;
    for (const q of [own, copy]) {
      expect(q.curvesUpgraded).toBe(true);
      expect(q.curves2D.outer).toHaveLength(1);
      expect(q.curves2D.outer[0]).toMatchObject({ type: "arc", r: 1 });
      // The runs index the polygon stored beside them.
      expect(q.curves2D.outer[0].count).toBe(q.polygon2D.length);
    }
  });

  it("leaves alone a profile pinned faceted, and one whose region is gone", () => {
    const pinned = { ...oldProfile(), curves2D: null };
    const lost = { ...oldProfile(), sketchId: 99 };
    const h = [createSketch, ...history([pinned, lost])];
    expect(upgradeProfileCurves(h, 0.05)).toBe(h);
  });

  it("pins only the profiles under a step that failed, in every copy", () => {
    const h = upgradeProfileCurves(
      [createSketch, ...history([oldProfile()])],
      0.05,
    );
    expect(pinFacetedProfiles(h, new Set([42]))).toBe(h);
    const pinned = pinFacetedProfiles(h, new Set([1]));
    expect(pinned[1].instruction.item.profile.curves2D).toBeNull();
    expect(pinned[1].instruction.item.profile.curvesUpgraded).toBeUndefined();
  });
});

describe("recalculating an older project", () => {
  // An older cylinder (10 mm radius, 10 mm tall) with one chamfer on what
  // `pick` selects, committed as the chamfer tool does.
  async function olderCylinderChamfered(pick) {
    const s = useStore.getState();
    s.newDocument();
    s.addItem(sketch);
    s.addItem({
      id: 2,
      name: "Extrude",
      type: "extrude",
      profile: oldProfile(),
      depth: 1,
      position: O,
      rotation: O,
      scale: S,
      children: [],
      parentId: null,
    });
    const items = useStore.getState().items;
    const item = items.find((i) => i.id === 2);
    const v = withWinding(item.profile.polygon2D, true);
    const subGeo = { edges: [], faces: [], ...pick(v) };
    const r = await occClient.chamferOrFilletItem({
      source: item,
      subGeo,
      amount: 0.05,
      segments: 1,
      allItems: items,
      printPrecision: s.resolutionMm,
    });
    s.modifyItem(
      2,
      {
        type: "csg",
        geometryData: r.geometryData,
        regenerator: {
          kind: "chamfer",
          source: item,
          subGeo: r.resolvedSubGeo,
          amount: 0.05,
          segments: 1,
          centerOffset: r.centerOffset,
          regeneratedAt: s.resolutionMm,
        },
      },
      "Chamfered",
    );
    await recalculateTimeline();
  }
  // The body's faces, rebuilt from its recipe rather than read off its mesh.
  async function bodyFaces() {
    const body = useStore.getState().items.find((i) => i.id === 2);
    const { geometryData, ...recipe } = body;
    const step = await ops.exportSTEP({
      items: [recipe],
      allItems: useStore.getState().items,
      precision: 0.05,
    });
    return {
      faces: (step.match(/ADVANCED_FACE\(/g) || []).length,
      cylinders: (step.match(/CYLINDRICAL_SURFACE\(/g) || []).length,
    };
  }
  const chamferStep = () => {
    const h = useStore.getState().history;
    return h[h.length - 1].instruction.patches.regenerator;
  };

  it("turns a rim chamfer's cylinder exact, the chamfer following the rim", async () => {
    // One facet's top-rim segment.
    await olderCylinderChamfered((v) => ({
      edges: [{ ax: v[5].x, ay: v[5].y, az: 1, bx: v[6].x, by: v[6].y, bz: 1 }],
    }));
    expect((await bodyFaces()).cylinders, "before the upgrade").toBe(0);
    await recalculateTimeline(true);
    expect(chamferStep().regenFailed).toBeFalsy();
    expect(chamferStep().source.profile.curvesUpgraded).toBe(true);
    // Wall, top, bottom and the chamfer round the rim it named.
    const after = await bodyFaces();
    expect(after, JSON.stringify(after)).toEqual({ faces: 4, cylinders: 1 });
  }, 120000);

  it("keeps the facets where a chamfer sits on the seam between two", async () => {
    await olderCylinderChamfered((v) => ({
      edges: [{ ax: v[5].x, ay: v[5].y, az: 0, bx: v[5].x, by: v[5].y, bz: 1 }],
    }));
    await recalculateTimeline(true);
    const reg = chamferStep();
    expect(reg.regenFailed, "the chamfer still builds").toBeFalsy();
    expect(reg.source.profile.curves2D).toBeNull();
    const profiles = useStore
      .getState()
      .history.map((e) => e.instruction?.item?.profile)
      .filter(Boolean);
    for (const p of profiles) expect(p.curves2D).toBeNull();
    const after = await bodyFaces();
    expect(after.cylinders, JSON.stringify(after)).toBe(0);
    expect(after.faces).toBeGreaterThan(30);
  }, 120000);
});
