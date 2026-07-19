// Shared Three.js scene colors. Centralised here so the viewport's palette
// (selection/hover highlights, sketch geometry, constraint icons, axis
// colors, etc.) can be tuned in one place instead of hunting through every
// scene/overlay module for a hex literal.

// --- PurpleCAD palette (ux-themes/theme-{dark,light}.css) ----------------
// Drives the 3D viewport and sketch-view colors (background, grid, sketch
// geometry, rulers, dimensions). Toolbar / panel chrome stays on the
// separate --bg-*/--text-* palette in src/styles/index.css.
const PCAD = {
  dark: {
    bg: 0x1a0d3b,
    surfaceRgb: "38, 33, 92",
    planeBorder: 0x6c3fd4,
    planeFill: 0x6c3fd4,
    sketchLine: 0x7f77dd,
    sketchNode: 0xd4a33f,
    sketchSelected: 0xeeedfe,
    sketchOffset: 0xba7517,
    sketchMirror: 0x00aaff,
    sketchCircularPattern: 0x33cc88,
    sketchRectangularPattern: 0xff8844,
    sketchConstruction: 0x3c3489,
    gridMajor: 0xd4a33f,
    gridMinor: 0xd4a33f,
    gridNode: 0x6c3fd4,
    gridOrigin: 0xd4a33f,
    grid3d: 0x6a6a75,
    rulerTick: 0xd4a33f,
    rulerLabel: 0xd4a33f,
    rulerCursor: 0x6c3fd4,
    dimLine: 0x6c3fd4,
    dimExtension: 0xc4c2b8,
    dimValue: 0xd4a33f,
    dimDriven: 0xba7517,
  },
  light: {
    bg: 0xf5f3ff,
    surfaceRgb: "238, 237, 254",
    planeBorder: 0x534ab7,
    planeFill: 0x534ab7,
    sketchLine: 0x534ab7,
    sketchNode: 0x854f0b,
    sketchSelected: 0x26215c,
    sketchOffset: 0x854f0b,
    sketchMirror: 0x0077cc,
    sketchCircularPattern: 0x1f8a55,
    sketchRectangularPattern: 0xcc5500,
    sketchConstruction: 0xafa9ec,
    gridMajor: 0x534ab7,
    gridMinor: 0x534ab7,
    gridNode: 0x7f77dd,
    gridOrigin: 0x854f0b,
    grid3d: 0x9a98a5,
    rulerTick: 0x854f0b,
    rulerLabel: 0x633806,
    rulerCursor: 0x534ab7,
    dimLine: 0x534ab7,
    dimExtension: 0xafa9ec,
    dimValue: 0x633806,
    dimDriven: 0x854f0b,
  },
};

function pcad(role, theme) {
  return PCAD[theme === "light" ? "light" : "dark"][role];
}

// --- Scene background -------------------------------------------------
export function sceneBackgroundFor(theme) {
  return pcad("bg", theme);
}

// --- Sketch plane (the translucent plane shown while sketching) ----------
export const sketchPlaneBorderColorFor = (theme) => pcad("planeBorder", theme);
export const sketchPlaneFillColorFor = (theme) => pcad("planeFill", theme);

// --- Sketch geometry -------------------------------------------------------
export const sketchLineColorFor = (theme) => pcad("sketchLine", theme);
export const sketchNodeColorFor = (theme) => pcad("sketchNode", theme);
export const sketchSelectedColorFor = (theme) => pcad("sketchSelected", theme);
export const sketchOffsetColorFor = (theme) => pcad("sketchOffset", theme);
export const sketchMirrorColorFor = (theme) => pcad("sketchMirror", theme);
export const sketchCircularPatternColorFor = (theme) =>
  pcad("sketchCircularPattern", theme);
export const sketchRectangularPatternColorFor = (theme) =>
  pcad("sketchRectangularPattern", theme);
export const sketchConstructionColorFor = (theme) =>
  pcad("sketchConstruction", theme);

// --- Grid ------------------------------------------------------------------
export const gridMajorColorFor = (theme) => pcad("gridMajor", theme);
// The 3D ground grid is neutral grey — the tinted grid colours are for the
// sketch plane only.
export const grid3dColorFor = (theme) => pcad("grid3d", theme);
export const gridMinorColorFor = (theme) => pcad("gridMinor", theme);
export const gridNodeColorFor = (theme) => pcad("gridNode", theme);
export const gridOriginColorFor = (theme) => pcad("gridOrigin", theme);

// --- Rulers ------------------------------------------------------------------
export const rulerTickColorFor = (theme) => pcad("rulerTick", theme);
export const rulerLabelColorFor = (theme) => pcad("rulerLabel", theme);
export const rulerCursorColorFor = (theme) => pcad("rulerCursor", theme);

// --- Dimensions --------------------------------------------------------------
export const dimLineColorFor = (theme) => pcad("dimLine", theme);
export const dimExtensionColorFor = (theme) => pcad("dimExtension", theme);
export const dimValueColorFor = (theme) => pcad("dimValue", theme);
export const dimDrivenColorFor = (theme) => pcad("dimDriven", theme);

// Canvas label background for dimension/constraint annotations — the
// surface color from the same palette, semi-transparent.
export const dimLabelBgFor = (theme) =>
  `rgba(${PCAD[theme === "light" ? "light" : "dark"].surfaceRgb}, 0.85)`;

// --- Lighting -----------------------------------------------------------
export const LIGHT_COLOR = 0xffffff;

// --- Axis colors (X red / Y blue / Z green) -----------------------------
// Shared by the axis indicator, dimension lines, and rotation handles so
// every "which axis is this" cue agrees.
export const AXIS_X_COLOR = 0xff4444;
export const AXIS_Y_COLOR = 0x4488ff;
export const AXIS_Z_COLOR = 0x44ff44;

// --- Object materials -----------------------------------------------------
// Fallback used when an object has no recorded original material color.
export const DEFAULT_MESH_COLOR = 0xe0e0e0;
export const WIREFRAME_EDGE_COLOR = 0x333333;
export const WIREFRAME_DISPLAY_COLOR = 0xaaaaaa;
export const NO_EMISSIVE = 0x000000;

// Emissive tints applied to selected/hovered objects in the 3D view.
export const EMISSIVE_SELECTED = 0x006666;
export const EMISSIVE_MULTI_SELECTED = 0x550011;
export const EMISSIVE_HOVERED = 0x444444;
// The cutting objects (tools) of a Boolean Cut, tinted red to read as "these
// get removed", distinct from the teal base object.
export const EMISSIVE_CUT = 0x992222;

// --- Face / edge selection & hover highlights ----------------------------
export const FACE_SELECT_COLOR = 0x3377cc;
export const FACE_HOVER_COLOR = 0x88ccff;
export const EDGE_SELECT_COLOR = 0xff5500;
export const EDGE_HOVER_COLOR = 0xffdd00;

// Extrude / cut profile-face highlights.
export const EXTRUDE_FACE_HIGHLIGHT = 0x4488ff;
export const EXTRUDE_FACE_HIGHLIGHT_ALT = 0x44ddff;
export const CUT_FACE_HIGHLIGHT = 0xff4444;
export const START_FACE_HIGHLIGHT = 0xff8833;

// Chamfer/fillet edge picking.
export const CHAMFER_EDGE_HOVER = 0xffdd00;
export const CHAMFER_PREVIEW_COLOR = 0xff44aa;

// --- Sketch geometry -------------------------------------------------------
export const SKETCH_FACE_HIGHLIGHT = 0x4488ff;
export const SKETCH_DRAW_PREVIEW_COLOR = 0x556677;
export const SKETCH_MODIFY_HIGHLIGHT = 0xffcc44;

// Bevel sketch geometry — rendered in a distinct color and made
// non-interactive while its driving constraint exists.
export const BEVEL_COLOR = 0xffaa44;

// Snap indicators.
export const SNAP_POINT_COLOR = 0xcc44ff;
export const SNAP_PREVIEW_COLOR = 0x88ccff;

// --- Sketch selection overlays (pivots, marquee, region fills) -----------
export const SKETCH_SELECTION_GREEN = 0x00ff88;
export const SKETCH_SELECTION_BLUE = 0x44aaff;
export const SKETCH_SELECTION_TEAL = 0x00ffcc;
export const SKETCH_PIVOT_COLOR = 0x00ddff;

// --- Sketch hover highlight ------------------------------------------------
export const SKETCH_HOVER_LINE_COLOR = 0xbbddff;
// Marks the line a hovered POINT belongs to, distinct from
// SKETCH_HOVER_LINE_COLOR's line-body hover so the two reads don't blur
// together.
export const SKETCH_HOVER_POINT_LINE_COLOR = 0xffaa33;

// --- Constraint icons & hover colors --------------------------------------
export const CONSTRAINT_COINCIDENT_COLOR = 0xffaa00;
export const CONSTRAINT_DISTANCE_COLOR = 0xffdd44;
export const CONSTRAINT_ON_LINE_COLOR = 0x00aaff;
export const CONSTRAINT_HORIZONTAL_COLOR = 0x00ddaa;
export const CONSTRAINT_VERTICAL_COLOR = 0x00ddaa;
export const CONSTRAINT_ANGLE_COLOR = 0xff66cc;
export const CONSTRAINT_PARALLEL_PERP_COLOR = 0xff8800;
export const CONSTRAINT_DEFAULT_COLOR = 0xffffff;

// Canvas 2D contexts (axis labels, sprites) take CSS color strings rather
// than THREE's numeric hex — derive one from the other so both stay in sync.
export function toCssHex(color) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

// Canvas label backgrounds/text for angle annotations.
export const ANGLE_LABEL_BG = "rgba(40,10,30,0.85)";
export const ANGLE_LABEL_TEXT = "#ff99dd";

export function constraintColor(type) {
  return (
    {
      coincident: CONSTRAINT_COINCIDENT_COLOR,
      distance: CONSTRAINT_DISTANCE_COLOR,
      onLine: CONSTRAINT_ON_LINE_COLOR,
      horizontal: CONSTRAINT_HORIZONTAL_COLOR,
      vertical: CONSTRAINT_VERTICAL_COLOR,
      angle: CONSTRAINT_ANGLE_COLOR,
    }[type] ?? CONSTRAINT_DEFAULT_COLOR
  );
}
