// The component motion dialog and play state in the store: the reference pick
// is live when the dialog opens, Confirm writes the motion onto the component
// (so it is saved with it), and play / stop / collision behave as the Objects
// list's buttons expect.
import { describe, it, expect, beforeEach } from "vitest";
import { useStore } from "../../store";
import { MOTION_DEFAULTS, motionToolProblem } from "../motionSlice.js";

const AXIS = { origin: { x: 0, y: 1, z: 0 }, dir: { x: 1, y: 0, z: 0 } };
const s = () => useStore.getState();

beforeEach(() => {
  useStore.setState({
    folders: [{ id: "folder-1", name: "Lid", parentId: null, expanded: true }],
    motionTool: null,
    motionPlaying: {},
    motionCollision: null,
    selectionOverride: null,
  });
});

describe("the motion dialog", () => {
  it("opens with the reference pick live and rotation chosen", () => {
    s().openMotionTool("folder-1");
    expect(s().motionTool).toMatchObject({
      folderId: "folder-1",
      type: "rotation",
      picking: true,
      reference: null,
      detectCollisions: true,
    });
    expect(s().motionTool.values).toEqual(MOTION_DEFAULTS);
    // Picking takes edges and faces in the 3D view.
    expect(s().selectionOverride).toEqual(["edge", "face"]);
  });

  it("a picked reference ends the pick", () => {
    s().openMotionTool("folder-1");
    s().setMotionReference({ ...AXIS, kind: "face" });
    expect(s().motionTool.picking).toBe(false);
    expect(s().selectionOverride).toBeNull();
  });

  it("can't be confirmed without a reference or with no range", () => {
    s().openMotionTool("folder-1");
    expect(motionToolProblem(s().motionTool)).toMatch(/reference/);
    s().confirmMotion();
    expect(s().folders[0].motion).toBeUndefined();
    s().setMotionReference(AXIS);
    s().setMotionValue("positive", 0);
    expect(motionToolProblem(s().motionTool)).toMatch(/range/);
  });

  it("Confirm writes the motion onto the component, for the chosen kind", () => {
    s().openMotionTool("folder-1");
    s().setMotionReference(AXIS);
    s().setMotionType("axis");
    s().setMotionValue("positive", 25);
    s().setMotionValue("negative", 5);
    s().setMotionValue("speed", 12);
    s().setMotionDetectCollisions(false);
    s().confirmMotion();
    expect(s().motionTool).toBeNull();
    expect(s().folders[0].motion).toEqual({
      type: "axis",
      axis: AXIS,
      positive: 25,
      negative: 5,
      speed: 12,
      detectCollisions: false,
    });
  });

  it("re-opening shows the component's own motion, with its reference kept", () => {
    s().openMotionTool("folder-1");
    s().setMotionReference(AXIS);
    s().setMotionValue("positive", 45);
    s().confirmMotion();
    s().openMotionTool("folder-1");
    expect(s().motionTool).toMatchObject({
      type: "rotation",
      picking: false,
      reference: AXIS,
    });
    expect(s().motionTool.values.rotation.positive).toBe(45);
  });
});

describe("playing a motion", () => {
  const withMotion = () => {
    s().openMotionTool("folder-1");
    s().setMotionReference(AXIS);
    s().confirmMotion();
  };

  it("does nothing for a component with no motion", () => {
    s().toggleMotionPlaying("folder-1");
    expect(s().motionPlaying).toEqual({});
  });

  it("plays and stops", () => {
    withMotion();
    s().toggleMotionPlaying("folder-1");
    expect(s().motionPlaying["folder-1"]).toBe(true);
    s().toggleMotionPlaying("folder-1");
    expect(s().motionPlaying["folder-1"]).toBeUndefined();
  });

  it("after a collision, play carries on and clears the collision", () => {
    withMotion();
    s().toggleMotionPlaying("folder-1");
    s().setMotionCollision("folder-1", { x: 1, y: 2, z: 3 });
    s().toggleMotionPlaying("folder-1");
    expect(s().motionPlaying["folder-1"]).toBe(true);
    expect(s().motionCollision).toBeNull();
  });
});
