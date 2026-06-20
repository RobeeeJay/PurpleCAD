// What the 3D view's selection widget currently allows.  A tool override (e.g.
// extrude → ["face"]) wins; otherwise object mode greys the sub-types, and with
// object off the face/edge/point toggles decide.  `overridden` lets the widget
// show the buttons as tool-locked.
export function effectiveSelectionTypes(s) {
  if (s.selectionOverride) {
    const set = new Set(s.selectionOverride);
    return {
      object: false,
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
