// Selection lock derived from the Split / Plane tools, which own their own
// picking — the widget just reflects what they're after.  Split operates on
// whole objects (its cut can be a plane/sketch object or a face); Plane is built
// from a face, or vertices in its 3-point mode.  Derived (not stored) so the
// lock can't get stuck through these tools' multi-phase open/close paths.
function toolSelectionLock(s) {
  if (s.splitTool) return ["object"];
  if (s.planeTool || s.planePickActive)
    return s.planePickActive === "points" ? ["point"] : ["face"];
  // Hole: pick a face, then a point (vertex / spot on the face).
  if (s.holeTool) return s.holeTool.phase === "face" ? ["face"] : ["point"];
  // Emboss: lock to faces while the face pick is armed; otherwise nothing (the
  // sketch-geometry pick raycasts the extrude-select fills, not objects).
  if (s.embossTool) return s.embossTool.picking === "faces" ? ["face"] : [];
  return null;
}

// What the 3D view's selection widget currently allows.  A tool override (e.g.
// extrude → ["face"]) wins; otherwise object mode greys the sub-types, and with
// object off the face/edge/point toggles decide.  `overridden` lets the widget
// show the buttons as tool-locked.
export function effectiveSelectionTypes(s) {
  const override = s.selectionOverride || toolSelectionLock(s);
  if (override) {
    const set = new Set(override);
    return {
      object: set.has("object"),
      face: set.has("face"),
      edge: set.has("edge"),
      point: set.has("point"),
      overridden: true,
    };
  }
  if (s.selObject) {
    return {
      object: true,
      face: false,
      edge: false,
      point: false,
      overridden: false,
    };
  }
  return {
    object: false,
    face: !!s.selFace,
    edge: !!s.selEdge,
    point: !!s.selPoint,
    overridden: false,
  };
}
