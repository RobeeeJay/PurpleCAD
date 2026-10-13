// Editing an extrude whose sketch is hidden at the extrude's own step (making
// the extrude hid it -- test-files/recalc-overload.pcad's last Extrude).  The
// edit shows the scene as of that step, and region fills were built for
// visible sketches only, so the edit opened with nothing to pick: no region
// highlighted, Confirm disabled.  The sketch an edited extrude was built from
// is offered even while hidden; other hidden sketches stay out.
import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { buildExtrudeSelectGroup } from "../sceneObjects/sketchOverlays.js";

const ring = (id, visible) => ({
  id,
  type: "sketch",
  visible,
  shapes: [
    { type: "circle", cx: 0, cy: 0, r: 0.25 },
    { type: "circle", cx: 0, cy: 0, r: 0.55 },
  ],
});
const objectsRef = {
  current: { 4: new THREE.Object3D(), 9: new THREE.Object3D() },
};
const sketchesWithFills = (group) =>
  [
    ...new Set(
      (group?.children ?? []).map((f) => f.userData.extrudeProfile.sketchId),
    ),
  ].sort();

describe("extrude edit with its sketch hidden", () => {
  it("offers no regions of a hidden sketch to a fresh extrude", () => {
    const g = buildExtrudeSelectGroup([ring(4, false)], objectsRef, 16, null);
    expect(sketchesWithFills(g)).toEqual([]);
  });

  it("offers the edited extrude's own sketch, hidden or not, and no other hidden one", () => {
    const g = buildExtrudeSelectGroup(
      [ring(4, false), ring(9, false)],
      objectsRef,
      16,
      null,
      new Set([4]),
    );
    expect(sketchesWithFills(g)).toEqual([4]);
  });
});
