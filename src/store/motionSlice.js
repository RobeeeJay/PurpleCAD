// Component motion: the dialog that sets a component's motion up, whether it
// is playing, and the collision that stopped it.  The motion itself is stored
// on the component (a `folders` entry) as `motion`, so it is saved with the
// project and the .pcad file; playing and collisions are session state.  The
// picking, the animation and the collision checks live in
// three/cameraControls/componentMotionTool.js; the maths in
// three/componentMotion.js.

import { saveFolders } from "./internals.js";
import { TOOL_RESET_PATCH } from "./uiToolReset.js";

// Starting values per kind: degrees and degrees per second for rotation, mm
// and mm per second for axis motion.
export const MOTION_DEFAULTS = {
  rotation: { positive: 90, negative: 0, speed: 45 },
  axis: { positive: 10, negative: 0, speed: 10 },
};

export const motionInitial = {
  // { folderId, type, picking, reference, values: {rotation, axis},
  //   detectCollisions } | null
  motionTool: null,
  // folderId -> true while that component's motion plays.
  motionPlaying: {},
  // { folderId, point: {x,y,z} } when a collision paused a motion.
  motionCollision: null,
};

// What the dialog is missing before it can be confirmed, in words, or null.
export function motionToolProblem(tool) {
  if (!tool.reference)
    return "Pick a reference: a face, an edge or a hole's rim on any part.";
  const v = tool.values[tool.type];
  if (!(v.positive >= 0) || !(v.negative >= 0))
    return "Extents can't be negative.";
  if (!(v.positive + v.negative > 0))
    return "Give the motion some range: a positive or negative extent.";
  if (!(v.speed > 0)) return "Speed must be more than 0.";
  return null;
}

export const createMotionSlice = (set, get) => ({
  // The Picking button starts live unless the component already has a
  // reference to keep.
  openMotionTool: (folderId) =>
    set((state) => {
      const folder = state.folders.find((f) => f.id === folderId);
      if (!folder) return {};
      const m = folder.motion;
      const values = {
        rotation: { ...MOTION_DEFAULTS.rotation },
        axis: { ...MOTION_DEFAULTS.axis },
      };
      if (m)
        values[m.type] = {
          positive: m.positive,
          negative: m.negative,
          speed: m.speed,
        };
      return {
        ...TOOL_RESET_PATCH,
        motionTool: {
          folderId,
          type: m?.type ?? "rotation",
          picking: !m?.axis,
          reference: m?.axis ?? null,
          values,
          detectCollisions: m?.detectCollisions ?? true,
        },
        selectedSubGeometry: null,
        selectionOverride: m?.axis ? null : ["edge", "face"],
      };
    }),

  cancelMotionTool: () =>
    set({
      motionTool: null,
      selectionOverride: null,
      selectedSubGeometry: null,
    }),

  setMotionType: (type) =>
    set((state) =>
      state.motionTool ? { motionTool: { ...state.motionTool, type } } : {},
    ),

  setMotionValue: (key, value) =>
    set((state) => {
      const t = state.motionTool;
      if (!t) return {};
      return {
        motionTool: {
          ...t,
          values: {
            ...t.values,
            [t.type]: { ...t.values[t.type], [key]: value },
          },
        },
      };
    }),

  setMotionDetectCollisions: (on) =>
    set((state) =>
      state.motionTool
        ? { motionTool: { ...state.motionTool, detectCollisions: on } }
        : {},
    ),

  setMotionPicking: (picking) =>
    set((state) =>
      state.motionTool
        ? {
            motionTool: { ...state.motionTool, picking },
            selectionOverride: picking ? ["edge", "face"] : null,
            selectedSubGeometry: null,
          }
        : {},
    ),

  // The pick, turned into an axis by the 3D view.  Picking ends with it.
  setMotionReference: (reference) =>
    set((state) =>
      state.motionTool
        ? {
            motionTool: { ...state.motionTool, reference, picking: false },
            selectionOverride: null,
            selectedSubGeometry: null,
          }
        : {},
    ),

  confirmMotion: () =>
    set((state) => {
      const t = state.motionTool;
      if (!t) return {};
      const problem = motionToolProblem(t);
      if (problem) return { toolError: problem };
      const v = t.values[t.type];
      const motion = {
        type: t.type,
        axis: t.reference,
        positive: v.positive,
        negative: v.negative,
        speed: v.speed,
        detectCollisions: t.detectCollisions,
      };
      const folders = state.folders.map((f) =>
        f.id === t.folderId ? { ...f, motion } : f,
      );
      saveFolders(folders);
      // A motion that changed while playing restarts from rest.
      const { [t.folderId]: _was, ...playing } = state.motionPlaying;
      return {
        folders,
        motionTool: null,
        selectionOverride: null,
        selectedSubGeometry: null,
        toolError: null,
        motionPlaying: playing,
        motionCollision:
          state.motionCollision?.folderId === t.folderId
            ? null
            : state.motionCollision,
      };
    }),

  // Play / stop.  Starting again after a collision clears it and carries on.
  toggleMotionPlaying: (folderId) =>
    set((state) => {
      const folder = state.folders.find((f) => f.id === folderId);
      if (!folder?.motion) return {};
      const playing = { ...state.motionPlaying };
      const collided = state.motionCollision?.folderId === folderId;
      if (playing[folderId] && !collided) delete playing[folderId];
      else playing[folderId] = true;
      return {
        motionPlaying: playing,
        motionCollision: collided ? null : state.motionCollision,
      };
    }),

  // The animation hit something: it stays where it is, flagged.
  setMotionCollision: (folderId, point) =>
    set({ motionCollision: { folderId, point } }),
});
