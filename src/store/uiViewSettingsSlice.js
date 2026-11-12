// View, display and persisted-settings actions: render/projection mode,
// theme, visibility toggles, notifications, and the Settings dialog values.
// This is the only part of the UI state that touches internals.js -- snap
// settings persist to disk, and the precision/curve-detection values dirty
// every timeline entry because they change how geometry tessellates.

import {
  getSystemTheme,
  saveSnapSettings,
  dirtyAllEntries,
  markWelcomeSeen,
  SNAP_DEFAULTS,
} from "./internals.js";

// The triangle limit on a mesh going into a boolean: kMaxTris in occ_io.cc's
// MakeSolidFromMesh, which refuses anything over it before sewing.
export const MAX_BOOLEAN_TRIANGLES = 50000;

// A refusal naming a mesh too detailed for a boolean offers to simplify it to
// fit.  The native message carries the mesh's exact triangle count, which
// picks out the body among the document's meshes; aimed a tenth under the
// limit so the result isn't refused again by a hair.
export function simplifyToFit(items, message) {
  const m = /too detailed \((\d+) triangles\)/.exec(message ?? "");
  if (!m) return null;
  const count = Number(m[1]);
  const body = (items ?? []).find((i) => {
    const g = i.type === "csg" && i.visible !== false && i.geometryData;
    if (!g?.positions) return false;
    const tris = g.indices?.length
      ? g.indices.length / 3
      : g.positions.length / 9;
    return tris === count;
  });
  if (!body) return null;
  return {
    kind: "simplifyToFit",
    itemId: body.id,
    targetTriangles: Math.floor(MAX_BOOLEAN_TRIANGLES * 0.9),
  };
}

export const createUiViewSettingsSlice = (set) => ({
  // The on-screen Shift (TouchModifiers.jsx): a finger or the Pencil has no
  // key to hold, so touchInput.js reads this as the events' shiftKey.
  touchShift: false,
  toggleTouchShift: () => set((state) => ({ touchShift: !state.touchShift })),
  setShadowsEnabled: (v) => set({ shadowsEnabled: !!v }),
  toggleCrossSectionView: () =>
    set((state) => ({ crossSectionView: !state.crossSectionView })),
  toggleConstraintsVisible: () =>
    set((state) => ({ constraintsVisible: !state.constraintsVisible })),
  toggleDimensionsVisible: () =>
    set((state) => ({ dimensionsVisible: !state.dimensionsVisible })),
  setRenderMode: (mode) => set({ renderMode: mode, pathTraceView: false }),
  setPathTraceView: (v) => set({ pathTraceView: !!v }),
  setProjectionMode: (mode) => set({ projectionMode: mode }),
  toggleProjectionMode: () =>
    set((state) => ({
      projectionMode:
        state.projectionMode === "perspective" ? "orthographic" : "perspective",
    })),
  toggleTheme: () =>
    set((state) => ({
      theme: state.theme === "light" ? "dark" : "light",
    })),
  toggleWidgetVisibility: () =>
    set((state) => ({ widgetVisible: !state.widgetVisible })),
  toggleAxisVisibility: () =>
    set((state) => {
      const axisVisible = !state.axisVisible;
      saveSnapSettings({ ...state, axisVisible });
      return { axisVisible };
    }),
  toggleHideHiddenItems: () =>
    set((state) => ({ hideHiddenItems: !state.hideHiddenItems })),
  showNotification: (message) =>
    set((state) => ({
      notification: message,
      notificationAction: simplifyToFit(state.items, message),
    })),
  clearNotification: () =>
    set({ notification: null, notificationAction: null }),
  toggleSnap: () =>
    set((state) => {
      const next = { ...state, snapEnabled: !state.snapEnabled };
      saveSnapSettings(next);
      return { snapEnabled: next.snapEnabled };
    }),
  setAlwaysExtrudeSingleObject: (v) =>
    set((state) => {
      const alwaysExtrudeSingleObject = !!v;
      saveSnapSettings({ ...state, alwaysExtrudeSingleObject });
      return { alwaysExtrudeSingleObject };
    }),
  setWheelDevice: (v) =>
    set((state) => {
      const wheelDevice = ["mouse", "trackpad"].includes(v) ? v : "auto";
      saveSnapSettings({ ...state, wheelDevice });
      return { wheelDevice };
    }),
  // Restore every configurable setting to its default (the snap/precision group
  // plus the session-only theme + orientation widget).
  resetSettings: () =>
    set(() => {
      saveSnapSettings(SNAP_DEFAULTS);
      return {
        ...SNAP_DEFAULTS,
        theme: getSystemTheme(),
        widgetVisible: true,
      };
    }),
  setSnapDistanceMm: (v) =>
    set((state) => {
      const n = Number(v);
      const snapDistanceMm = Number.isFinite(n) && n > 0 ? n : 5;
      saveSnapSettings({ ...state, snapDistanceMm });
      return { snapDistanceMm };
    }),
  setSnapAngleDeg: (v) =>
    set((state) => {
      const n = Number(v);
      const snapAngleDeg = Number.isFinite(n) && n > 0 ? n : 9;
      saveSnapSettings({ ...state, snapAngleDeg });
      return { snapAngleDeg };
    }),
  setFov: (v) =>
    set((state) => {
      const n = Number(v);
      // Clamp to a sane perspective range; very low = nearly orthographic.
      const fov = Number.isFinite(n) ? Math.min(90, Math.max(5, n)) : 35;
      saveSnapSettings({ ...state, fov });
      return { fov };
    }),
  setCurveDetectionAngleDeg: (v) =>
    set((state) => {
      const n = Number(v);
      const curveDetectionAngleDeg =
        Number.isFinite(n) && n >= 0 ? Math.min(90, n) : 5;
      saveSnapSettings({ ...state, curveDetectionAngleDeg });
      return { curveDetectionAngleDeg };
    }),

  // The Resolution setting.  A new value re-tessellates every step, so it
  // invalidates every cached entry (the one edit that rightly marks the WHOLE
  // timeline -- every other edit starts from the first step it reaches,
  // invalidateEdit in internals.js), and useSceneSync runs a forced recalc.
  setResolutionMm: (v) =>
    set((state) => {
      const n = Number(v);
      const resolutionMm =
        Number.isFinite(n) && n > 0 ? Math.min(5, Math.max(0.001, n)) : 0.05;
      if (resolutionMm === state.resolutionMm) return {};
      saveSnapSettings({ ...state, resolutionMm });
      return { resolutionMm, history: dirtyAllEntries(state.history) };
    }),
  setSettingsDialogOpen: (open) => set({ settingsDialogOpen: !!open }),
  setAboutDialogOpen: (open) => set({ aboutDialogOpen: !!open }),
  // Closing it, by any route, is what counts as having seen it.
  closeWelcomeDialog: () => {
    markWelcomeSeen();
    set({ welcomeDialogOpen: false });
  },
  setWelcomeDialogOpen: (open) => set({ welcomeDialogOpen: !!open }),
  setProjectsDialogOpen: (open) => set({ projectsDialogOpen: !!open }),
  setSceneInspectorOpen: (open) => set({ sceneInspectorOpen: !!open }),
});
