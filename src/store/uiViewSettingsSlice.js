// View, display and persisted-settings actions: render/projection mode,
// theme, visibility toggles, notifications, and the Settings dialog values.
// This is the only part of the UI state that touches internals.js -- snap
// settings persist to disk, and the precision/curve-detection values dirty
// every timeline entry because they change how geometry tessellates.

import {
  getSystemTheme,
  saveSnapSettings,
  dirtyAllEntries,
  SNAP_DEFAULTS,
} from "./internals.js";

export const createUiViewSettingsSlice = (set) => ({
  setShadowsEnabled: (v) => set({ shadowsEnabled: !!v }),
  toggleCrossSectionView: () =>
    set((state) => ({ crossSectionView: !state.crossSectionView })),
  toggleConstraintsVisible: () =>
    set((state) => ({ constraintsVisible: !state.constraintsVisible })),
  toggleDimensionsVisible: () =>
    set((state) => ({ dimensionsVisible: !state.dimensionsVisible })),
  toggleCurveResolution: () =>
    // Changing tessellation resolution invalidates every cached entry (JIT
    // timeline): each step must re-tessellate at the new precision.
    set((state) => ({
      curveResolution: state.curveResolution === "print" ? "preview" : "print",
      history: dirtyAllEntries(state.history),
    })),
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
  showNotification: (message) => set({ notification: message }),
  clearNotification: () => set({ notification: null }),
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

  setPreviewPrecisionMm: (v) =>
    set((state) => {
      const n = Number(v);
      const previewPrecisionMm =
        Number.isFinite(n) && n > 0 ? Math.min(5, Math.max(0.001, n)) : 0.5;
      saveSnapSettings({ ...state, previewPrecisionMm });
      return { previewPrecisionMm };
    }),
  setPrintPrecisionMm: (v) =>
    set((state) => {
      const n = Number(v);
      const printPrecisionMm =
        Number.isFinite(n) && n > 0 ? Math.min(5, Math.max(0.001, n)) : 0.01;
      saveSnapSettings({ ...state, printPrecisionMm });
      return { printPrecisionMm };
    }),
  setSettingsDialogOpen: (open) => set({ settingsDialogOpen: !!open }),
  setAboutDialogOpen: (open) => set({ aboutDialogOpen: !!open }),
  setProjectsDialogOpen: (open) => set({ projectsDialogOpen: !!open }),
  setSceneInspectorOpen: (open) => set({ sceneInspectorOpen: !!open }),
});
