// Barrel re-export for the scene-object construction code.  The
// previously single 2300-line file was split into topical modules
// under sceneObjects/ — this file keeps the original public API
// surface so every consumer (csgUtils, cameraControls,
// sketchConstraints, selectionHighlights, occOps, geometryParams,
// tests) keeps working without a path change.

export {
  MM_PER_UNIT,
  snapUnitToIntervalMm,
  DISPLAY_PRECISION_MM,
  HANDLE_CONFIGS,
  fullCircleSegments,
  getObjectDimensions,
  getObjectExtent,
  getMeshDimensions,
  getMeshExtent,
  getMeshBBoxCenter,
  makeDimSprite,
  redrawDimSprite,
  placeDimLabels,
  makeMeasureLabel,
} from "./sceneObjects/dimensions.js";

export {
  buildSketchShape,
  getSketchShapePoints,
  sketchDimText,
  moveShapePoint,
  getSnapPoints,
  getShapePoint,
  getShapeLength,
} from "./sceneObjects/sketchShapes.js";

export {
  findClosedLoops,
  findClosedLoopsWithShapes,
  polyContainsPoint,
  polyCentroid,
  polyArea,
  groupLoopsWithHoles,
} from "./sceneObjects/closedLoops.js";

export { buildSceneObjects } from "./sceneObjects/sceneBuilder.js";
export { buildTransformHandles } from "./sceneObjects/transformHandles.js";

export {
  buildAllSketchShapesGroup,
  buildExtrudeSelectGroup,
  rebuildPointDotsForDrag,
  buildSketchShapesGroup,
} from "./sceneObjects/sketchOverlays.js";
export { rebuildConstraintIconsForDrag } from "./sceneObjects/constraintIcons.js";

export { applyRenderMode } from "./sceneObjects/renderMode.js";
