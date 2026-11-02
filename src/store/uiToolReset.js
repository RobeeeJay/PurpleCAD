// Clearing every in-progress tool phase in one patch.  Starting any tool
// wipes the others, so each tool's start/cancel action spreads this rather
// than listing the twenty-odd sibling slots it needs to null out.  Lives in
// its own module so the tool slices and uiSlice can all import it without a
// cycle.

// The timeline label of a face-to-ground step, which records rotation too.
export const LAID_ON_FACE = "Laid on face";

export const TOOL_RESET_PATCH = {
  sketchPlacementMode: false,
  extrudeSelectMode: null,
  extrudeRetargetId: null,
  extrudeRetargetGroup: null,
  extrudeRetargetFusedId: null,
  extrudeEditReturn: null,
  extrudeDepthInput: null,
  cutExtrudeInProgress: false,
  chamferSelectMode: null,
  chamferEditTarget: null,
  pushPullSelectMode: null,
  pushPullRetargetTarget: null,
  pushPullEditTarget: null,
  shellTarget: null,
  simplifyTarget: null,
  convertTarget: null,
  holeTool: null,
  embossTool: null,
  textureTool: null,
  draftTool: null,
  measureTool: null,
  sweepSelectMode: null,
  sweepRetargetTarget: null,
  planeTool: null,
  planePickActive: false,
  pattern3dTool: null,
  circularAxisPick: false,
  mirror3dTool: null,
  booleanTool: null,
  booleanCutIds: [],
  additiveObjectPick: false,
  projectTool: null,
  splitTool: null,
  splitPick: null,
  originToolActive: false,
  originDialogItemId: null,
  originVertexPick: null,
  pointToPointTool: null,
  faceToGroundTool: null,
  motionTool: null,
  selectionOverride: null,
  toolError: null,
};
