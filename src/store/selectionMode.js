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
  // Point-to-Point: pick vertices while a point is armed.
  if (s.pointToPointTool && s.pointToPointTool.picking) return ["point"];
  // Draft: pick faces (the neutral plane, then the faces to taper).
  if (s.draftTool && s.draftTool.picking) return ["face"];
  return null;
}

// True while any modal create / modify / sketch tool owns the interaction — a
// guided pick flow, a retarget/edit pick, an open op dialog, or a sketch drawing
// tool.  The Timeline uses this to lock navigation: jumping to another history
// step mid-tool would pull the very geometry the tool is targeting out from
// under it.  Add new modal tools here as they're introduced.
export function anyToolActive(s) {
  return !!(
    s.sketchPlacementMode ||
    s.activeSketchTool ||
    s.extrudeSelectMode ||
    s.extrudeRetargetId ||
    s.extrudeRetargetGroup ||
    s.extrudeDepthInput ||
    s.chamferSelectMode ||
    s.chamferRetargetTarget ||
    s.chamferEditTarget ||
    s.pushPullSelectMode ||
    s.pushPullRetargetTarget ||
    s.pushPullEditTarget ||
    s.shellTarget ||
    s.holeTool ||
    s.embossTool ||
    s.draftTool ||
    s.sweepSelectMode ||
    s.sweepRetargetTarget ||
    s.planeTool ||
    s.planePickActive ||
    s.pattern3dTool ||
    s.circularAxisPick ||
    s.mirror3dTool ||
    s.projectTool ||
    s.splitTool ||
    s.splitPick ||
    s.originToolActive ||
    s.originDialogItemId ||
    s.originVertexPick ||
    s.pointToPointTool
  );
}

// Which sketch selection kinds a click resolves to, given the user's toggles AND
// the active tool: constraint modes pick points, the Project tool picks objects.
// Disallowed kinds are greyed in the widget but the user's choice is preserved,
// so it's restored when the tool closes.  Returns { eff, allowed } maps.
export function effectiveSketchSelTypes(s) {
  const KEYS = ["line", "point", "shape", "constraint", "object"];
  const user = s.sketchSelTypes || {
    line: true,
    point: true,
    shape: true,
    constraint: false,
    object: false,
  };
  let allowed;
  if (s.projectTool) allowed = { object: true };
  else if (s.sketchConstraintMode) allowed = { point: true };
  // `object` is only ever usable while projecting, so it's omitted by default.
  else allowed = { line: true, point: true, shape: true, constraint: true };

  const eff = {};
  let any = false;
  for (const k of KEYS) {
    eff[k] = !!(user[k] && allowed[k]);
    if (eff[k]) any = true;
  }
  // The tool requires a kind none of the user toggles cover (e.g. constraint mode
  // needs a point but the user had only lines on) — fall back to the tool's
  // allowed set so the required pick still works.
  if (!any) for (const k of KEYS) eff[k] = !!allowed[k];
  return { eff, allowed };
}

// A hair of angle so that with chaining OFF a flat face's coplanar triangles
// (and a straight edge's collinear segments) still select as one, while any
// real curvature stops the growth at the first facet/segment.
const NO_CHAIN_ANGLE_DEG = 0.5;

// The dihedral/turn limit (degrees) selection chaining should use right now.
// With the chain toggle on AND a face/edge type effectively selectable, it's
// the user's curveDetectionAngleDeg (follow the curve); otherwise it collapses
// to NO_CHAIN_ANGLE_DEG (pick just the clicked facet / segment).  Shared by the
// hover-highlight, persistent-selection, and pending-selection code so all
// three agree on what one click grabs.
export function selectionChainAngle(s) {
  // No store handed in (unit tests exercising the pure highlight builders) —
  // fall back to the default chain angle, matching the prior always-chaining.
  if (!s) return 5;
  const eff = effectiveSelectionTypes(s);
  const on = !!(s.selChain && (eff.face || eff.edge));
  return on ? (s.curveDetectionAngleDeg ?? 5) : NO_CHAIN_ANGLE_DEG;
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
