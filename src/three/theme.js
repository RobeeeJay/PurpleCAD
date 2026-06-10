// Shared Three.js scene colors. Centralised here so the viewport's palette
// (selection/hover highlights, sketch geometry, constraint icons, axis
// colors, etc.) can be tuned in one place instead of hunting through every
// scene/overlay module for a hex literal.

// --- Scene background -------------------------------------------------
export const SCENE_BG_DARK = 0x1a1a1a;
export const SCENE_BG_LIGHT = 0xe8e8e8;

export function sceneBackgroundFor(theme) {
  return theme === "light" ? SCENE_BG_LIGHT : SCENE_BG_DARK;
}

// --- Lighting -----------------------------------------------------------
export const LIGHT_COLOR = 0xffffff;

// --- Axis colors (X red / Y blue / Z green) -----------------------------
// Shared by the axis indicator, dimension lines, and rotation handles so
// every "which axis is this" cue agrees.
export const AXIS_X_COLOR = 0xff4444;
export const AXIS_Y_COLOR = 0x4488ff;
export const AXIS_Z_COLOR = 0x44ff44;

// --- Object materials -----------------------------------------------------
export const DEFAULT_OBJECT_COLOR = 0xcccccc;
// Fallback used when an object has no recorded original material color.
export const DEFAULT_MESH_COLOR = 0xe0e0e0;
export const WIREFRAME_EDGE_COLOR = 0x333333;
export const WIREFRAME_DISPLAY_COLOR = 0xaaaaaa;
export const NO_EMISSIVE = 0x000000;

// Emissive tints applied to selected/hovered objects in the 3D view.
export const EMISSIVE_SELECTED = 0x006666;
export const EMISSIVE_MULTI_SELECTED = 0x550011;
export const EMISSIVE_HOVERED = 0x444444;

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
export const SKETCH_LINE_COLOR = 0x88aaff;
export const SKETCH_POINT_COLOR = 0xaabbff;
export const SKETCH_PLANE_COLOR = 0x88aaff;
export const SKETCH_PLANE_HOVER_COLOR = 0x6688cc;
export const SKETCH_FACE_HIGHLIGHT = 0x4488ff;
export const SKETCH_DRAW_PREVIEW_COLOR = 0x556677;
export const SKETCH_MODIFY_HIGHLIGHT = 0xffcc44;

// Offset / bevel sketch geometry — rendered in distinct colors and made
// non-interactive while their driving constraint exists.
export const OFFSET_COLOR = 0xb266ff;
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
// Grey used for technical-drawing-style dimension lines/ticks.
export const DIM_COLOR = 0x808080;

export const CONSTRAINT_COINCIDENT_COLOR = 0xffaa00;
export const CONSTRAINT_DISTANCE_COLOR = 0xffdd44;
export const CONSTRAINT_ON_LINE_COLOR = 0x00aaff;
export const CONSTRAINT_HORIZONTAL_COLOR = 0x00ddaa;
export const CONSTRAINT_VERTICAL_COLOR = 0x00ddaa;
export const CONSTRAINT_ANGLE_COLOR = 0xff66cc;
export const CONSTRAINT_PARALLEL_PERP_COLOR = 0xff8800;
export const CONSTRAINT_DEFAULT_COLOR = 0xffffff;
export const CONSTRAINT_SELECTED_COLOR = 0xff4444;

// Canvas 2D contexts (axis labels, sprites) take CSS color strings rather
// than THREE's numeric hex — derive one from the other so both stay in sync.
export function toCssHex(color) {
  return `#${color.toString(16).padStart(6, "0")}`;
}

// Canvas label backgrounds/text for dimension and angle annotations.
export const DIM_LABEL_BG = "rgba(35,35,35,0.85)";
export const DIM_LABEL_TEXT = "#dddddd";
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
