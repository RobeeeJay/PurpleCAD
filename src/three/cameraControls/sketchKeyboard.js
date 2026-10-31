// Sketch-mode keyboard shortcuts: arrow-key nudge, selection-type toggles,
// copy/paste/group/ungroup/delete, Escape (cancels the active tool/mode in a
// fixed priority order), the 3D-view render-mode number keys, and the
// single-key sketch tool binds.  Split out of sketchInteraction.js.  The
// clipboard buffer lives here (used only by this handler); the marquee /
// long-press flags are shared refs owned by the caller (the mouse handlers
// set them, Escape clears them).

import { useStore } from "../../store";
import { MM_PER_UNIT } from "../sceneObjects.js";
import { translateShape } from "../sketchGeometry.js";
import {
  constraintsAmong,
  remapConstraintShapeIndices,
} from "../../store/internals.js";

// What a copy carries besides the shapes: the joins between them, and the lock
// that keeps a cog or a text a single editable shape -- without it a pasted
// cog was plain outline that its editor would no longer open on.
const CLIPBOARD_CONSTRAINTS = new Set(["coincident", "cog", "text"]);
import {
  selectedSketchLineIndices,
  offsetSelectedSketchGeometry,
  openGapDistanceFromSelection,
} from "../sketchModifyActions.js";

export function createSketchKeyboardHandler(
  {
    sketchModeRef,
    itemsRef,
    objectsRef,
    selectedIdRef,
    extrudeSelectModeRef,
    sketchPlacementModeRef,
    cameraControlsRef,
    sketchDrawRef,
    multiSelectedRef,
    longPressMenuRef,
    marqueeStartRef,
    marqueeActiveRef,
  },
  {
    isMac,
    solveDrag,
    refreshSketchSelectionOverlay,
    showMultiSelectOverlays,
    clearMultiSelectOverlays,
    clearCoincidentFirstOverlay,
    clearSketchSelection,
    sketchSelectLine,
    cancelSketchDraw,
    clearMarqueeRect,
    clearModifyPreview,
    clearMirrorPreview,
    clearCircularPatternPreview,
    clearRectangularPatternPreview,
    getSelectedConstraintIdx,
    clearConstraintSelection,
    clearStartHighlight,
    cancelExtrude,
  },
) {
  // { shapes: [...], constraints: [...] } — set by Cmd/Ctrl+C, read by paste.
  let sketchClipboard = null;

  const onKeyDown = (e) => {
    const tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable)
      return;

    // Arrow keys nudge the selected sketch geometry by 1mm (one grid step in
    // scene units), or 0.1mm with Shift held, for fine placement.  Translates
    // the whole selection rigidly, then solves the rest of the system around
    // it — same path a body drag uses.
    const nudge = {
      ArrowUp: [0, 1],
      ArrowDown: [0, -1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    }[e.key];
    if (
      nudge &&
      sketchModeRef.current &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey
    ) {
      const sel = useStore.getState().selectedSketchElement;
      const indices =
        multiSelectedRef.current.length > 0
          ? [...multiSelectedRef.current]
          : sel?.shapeIdx != null
            ? [sel.shapeIdx]
            : null;
      const selItem = itemsRef.current.find(
        (i) => i.id === selectedIdRef.current,
      );
      if (indices && selItem) {
        e.preventDefault();
        const step = (e.shiftKey ? 0.1 : 1) / MM_PER_UNIT;
        const dx = nudge[0] * step;
        const dy = nudge[1] * step;
        const placed = new Map();
        const keys = new Map();
        for (const idx of indices) {
          const moved = translateShape(selItem.shapes[idx], dx, dy);
          if (moved) {
            placed.set(idx, moved);
            keys.set(idx, null);
          }
        }
        if (placed.size > 0) {
          const solved = solveDrag(selItem.id, placed, keys, null);
          useStore.getState().updateSketchShapes(selItem.id, solved);
          refreshSketchSelectionOverlay();
        }
      }
      return;
    }

    // Shift+Z / Shift+X toggle constraint / dimension visibility — the two
    // toggles the Shift-held selection widget shows — in both 3D and sketch.
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        useStore.getState().toggleConstraintsVisible();
        return;
      }
      if (k === "x") {
        e.preventDefault();
        useStore.getState().toggleDimensionsVisible();
        return;
      }
    }

    // Z X C V B press the selection widget's buttons in order, for whichever
    // widget is showing: 3D = object/face/edge/point, then Chain (its fifth
    // button, which only acts while faces or edges are on); sketch =
    // object/shape/line/point/constraint.  Bare keys only -- Ctrl/Cmd/Alt combos
    // stay free for copy/undo/etc.
    if (!e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const idx = { z: 0, x: 1, c: 2, v: 3, b: 4 }[e.key.toLowerCase()];
      if (idx !== undefined) {
        const store = useStore.getState();
        if (sketchModeRef.current) {
          e.preventDefault();
          store.toggleSketchSelType(
            ["object", "shape", "line", "point", "constraint"][idx],
          );
        } else {
          const toggle = [
            store.toggleSelObject,
            store.toggleSelFace,
            store.toggleSelEdge,
            store.toggleSelPoint,
            store.toggleSelChain,
          ][idx];
          if (toggle) {
            e.preventDefault();
            toggle();
          }
        }
        return;
      }
    }

    // Debug export: copy the whole active sketch (shapes + constraints) to the
    // clipboard as JSON, for sharing a reproducer.  Cmd/Ctrl+Shift+C.
    if (
      sketchModeRef.current &&
      (isMac ? e.metaKey : e.ctrlKey) &&
      e.shiftKey &&
      e.key.toLowerCase() === "c"
    ) {
      const selItem = itemsRef.current.find(
        (i) => i.id === selectedIdRef.current,
      );
      if (!selItem) return;
      e.preventDefault();
      const dump = JSON.stringify(
        {
          shapes: selItem.shapes || [],
          constraints: selItem.constraints || [],
        },
        null,
        2,
      );
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(dump);
      console.warn("[SKETCH DUMP]\n" + dump);
      return;
    }

    if (
      sketchModeRef.current &&
      (isMac ? e.metaKey : e.ctrlKey) &&
      !e.shiftKey &&
      e.key === "c"
    ) {
      const selItem = itemsRef.current.find(
        (i) => i.id === selectedIdRef.current,
      );
      if (!selItem) return;
      const shapes = selItem.shapes || [];
      const constraints = selItem.constraints || [];
      const sel = useStore.getState().selectedSketchElement;
      const indices =
        multiSelectedRef.current.length > 0
          ? [...multiSelectedRef.current]
          : sel?.type === "line"
            ? [sel.shapeIdx]
            : [];
      if (indices.length === 0) return;
      e.preventDefault();
      const present = indices.filter((i) => shapes[i]);
      sketchClipboard = {
        shapes: present.map((i) => shapes[i]),
        constraints: constraintsAmong(
          constraints,
          present,
          CLIPBOARD_CONSTRAINTS,
        ),
      };
      return;
    }

    if (
      sketchModeRef.current &&
      (isMac ? e.metaKey : e.ctrlKey) &&
      e.key === "v"
    ) {
      if (!sketchClipboard) return;
      const selItem = itemsRef.current.find(
        (i) => i.id === selectedIdRef.current,
      );
      if (!selItem) return;
      e.preventDefault();
      const baseIdx = (selItem.shapes || []).length;
      const PASTE_OFFSET = 0.5;
      // Clipboard position -> new sketch index, or -1 for a shape that could
      // not be moved.  Dropping one used to shift every later shape down while
      // the constraints kept the old numbering, joining the wrong shapes.
      const newShapes = [];
      const pasteMap = new Map();
      sketchClipboard.shapes.forEach((s, i) => {
        const moved = translateShape(s, PASTE_OFFSET, PASTE_OFFSET);
        if (!moved) return pasteMap.set(i, -1);
        // Pasted copies start ungrouped (don't inherit the source's group).
        const { group, ...ungrouped } = moved;
        pasteMap.set(i, baseIdx + newShapes.length);
        newShapes.push(group == null ? moved : ungrouped);
      });
      const newConstraints = sketchClipboard.constraints
        .map((c) => remapConstraintShapeIndices(c, pasteMap))
        .filter(Boolean);
      useStore
        .getState()
        .addSketchShapes(selectedIdRef.current, newShapes, newConstraints);
      // The copies become the selection, so they can be dragged or nudged
      // straight away -- they used to land unselected beside the originals,
      // which stayed selected, so a drag moved the wrong geometry.  One shape
      // is selected exactly as a click would select it, so the tools that act
      // on a single selected line (Horizontal, Offset, ...) take it; several
      // become a multi-selection, as a marquee makes.
      const pasted = newShapes.map((_, i) => baseIdx + i);
      clearSketchSelection();
      if (pasted.length === 1) {
        const sketchMesh = objectsRef.current[selectedIdRef.current];
        if (sketchMesh) sketchSelectLine(pasted[0], newShapes[0], sketchMesh);
      } else {
        multiSelectedRef.current = pasted;
        showMultiSelectOverlays(pasted);
      }
      return;
    }

    // Cmd/Ctrl+G — group the selected sketch shapes (2+) so they act as a unit.
    if (
      sketchModeRef.current &&
      (isMac ? e.metaKey : e.ctrlKey) &&
      !e.shiftKey &&
      e.key.toLowerCase() === "g"
    ) {
      if (multiSelectedRef.current.length < 2) return;
      e.preventDefault();
      const indices = [...multiSelectedRef.current];
      useStore.getState().groupSketchShapes(selectedIdRef.current, indices);
      showMultiSelectOverlays(indices);
      return;
    }

    // Cmd/Ctrl+U — ungroup the selected sketch shapes.
    if (
      sketchModeRef.current &&
      (isMac ? e.metaKey : e.ctrlKey) &&
      !e.shiftKey &&
      e.key.toLowerCase() === "u"
    ) {
      const sel = useStore.getState().selectedSketchElement;
      const indices =
        multiSelectedRef.current.length > 0
          ? [...multiSelectedRef.current]
          : sel?.type === "line"
            ? [sel.shapeIdx]
            : [];
      if (indices.length === 0) return;
      e.preventDefault();
      useStore.getState().ungroupSketchShapes(selectedIdRef.current, indices);
      return;
    }

    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      sketchModeRef.current
    ) {
      const selConstraintIdx = getSelectedConstraintIdx();
      if (selConstraintIdx !== null) {
        e.preventDefault();
        useStore
          .getState()
          .deleteSketchConstraint(selectedIdRef.current, selConstraintIdx);
        clearConstraintSelection();
        return;
      }
      const sel = useStore.getState().selectedSketchElement;
      const selShapes =
        itemsRef.current.find((i) => i.id === selectedIdRef.current)?.shapes ||
        [];
      const toDelete =
        multiSelectedRef.current.length > 0
          ? [...multiSelectedRef.current]
          : sel?.type === "line"
            ? [sel.shapeIdx]
            : // A selected standalone point deletes that point (a line's
              // endpoint node, also type "point", is left alone).
              sel?.type === "point" && selShapes[sel.shapeIdx]?.type === "point"
              ? [sel.shapeIdx]
              : null;
      if (toDelete?.length > 0) {
        e.preventDefault();
        useStore.getState().deleteSketchShapes(selectedIdRef.current, toDelete);
        clearMultiSelectOverlays();
        multiSelectedRef.current = [];
        clearSketchSelection();
      }
      return;
    }

    if (e.key === "Escape") {
      if (longPressMenuRef.current) {
        longPressMenuRef.current = false;
        useStore.getState().setSketchLongPressMenu(null);
        return;
      }
      // Placing/editing a reference underlay: Esc abandons it, restoring the
      // committed values when this was a re-open of an existing one.
      const under = useStore.getState().underlayImport;
      if (under) {
        if (under.editing && under.original)
          useStore.getState().setSketchUnderlay(under.sketchId, under.original);
        useStore.getState().clearUnderlayImport();
        return;
      }
      if (getSelectedConstraintIdx() !== null) {
        clearConstraintSelection();
        return;
      }
      if (extrudeSelectModeRef && extrudeSelectModeRef.current) {
        // Esc from the start-pick sub-mode backs out to the profile phase
        // (keeping the captured profiles + depth) rather than cancelling the
        // whole extrude — so geometry stays selectable.  (Returning to the
        // legacy "depth" state left every click unhandled: selection was dead.)
        if (
          extrudeSelectModeRef.current === "start" ||
          extrudeSelectModeRef.current === "to"
        ) {
          clearStartHighlight();
          useStore.getState().setExtrudeSelectMode("profile");
          return;
        }
        cancelExtrude();
        return;
      }
      if (useStore.getState().chamferSelectMode) {
        cameraControlsRef.current?.clearChamferPreview?.();
        useStore.getState().setChamferSelectMode(null);
        useStore.getState().clearSelectedSubGeometry();
        const editTarget = useStore.getState().chamferEditTarget;
        if (editTarget) {
          // Editing viewed the pre-chamfer step — put the user back on the entry.
          useStore.getState().restoreToHistory(editTarget.entryId);
          useStore.getState().setChamferEditTarget(null);
        }
        return;
      }
      if (sketchPlacementModeRef.current) {
        useStore.getState().setSketchPlacementMode(false);
        return;
      }
      if (sketchModeRef.current) {
        const store = useStore.getState();
        if (store.sketchModifyMode) {
          store.setSketchModifyMode(null);
          clearModifyPreview();
          return;
        }
        if (store.activeSketchTool === "mirror") {
          store.cancelMirrorTool();
          clearMirrorPreview();
          return;
        }
        if (store.activeSketchTool === "circularPattern") {
          store.cancelCircularPatternTool();
          clearCircularPatternPreview();
          return;
        }
        if (store.activeSketchTool === "rectangularPattern") {
          store.cancelRectangularPatternTool();
          clearRectangularPatternPreview();
          return;
        }
        if (store.sketchAngleInput) {
          store.setSketchAngleInput(null);
          return;
        }
        if (store.sketchConstraintMode || store.sketchDistanceInput) {
          store.setSketchConstraintMode(null);
          store.setSketchConstraintFirstPoint(null);
          store.setSketchDistanceInput(null);
          clearCoincidentFirstOverlay();
          return;
        }
        if (sketchDrawRef.current) {
          cancelSketchDraw();
        } else {
          useStore.getState().setActiveSketchTool(null);
          clearSketchSelection();
          clearMarqueeRect();
          marqueeStartRef.current = null;
          marqueeActiveRef.current = false;
        }
        return;
      }
    }

    // 3D-view render mode shortcuts: 1-4 switch the shaded/wireframe/etc.
    // mode, 5-8 toggle the remaining Render-section buttons (shadows,
    // cross-section, path tracer, curve resolution) — same left-to-right
    // order they appear in RenderSection.jsx.
    if (
      !sketchModeRef.current &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      !e.shiftKey
    ) {
      const store = useStore.getState();
      const renderModeKeys = {
        1: "wireframe",
        2: "transparent",
        3: "shaded",
      };
      if (renderModeKeys[e.key]) {
        e.preventDefault();
        store.setRenderMode(renderModeKeys[e.key]);
        return;
      }
      // 4 selects the path-traced render mode (1-3 select the raster modes).
      if (e.key === "4") {
        e.preventDefault();
        store.setPathTraceView(true);
        return;
      }
      if (e.key === "5") {
        e.preventDefault();
        store.setShadowsEnabled(!store.shadowsEnabled);
        return;
      }
      if (e.key === "6") {
        e.preventDefault();
        store.toggleCrossSectionView();
        return;
      }
    }

    if (sketchModeRef.current && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const key = e.key.toLowerCase();
      const store = useStore.getState();

      // D toggles the distance-dimension constraint tool.
      if (key === "d") {
        e.preventDefault();
        const isActive = store.sketchConstraintMode === "distance";
        store.setSketchConstraintMode(isActive ? null : "distance");
        store.setSketchConstraintFirstPoint(null);
        store.setSketchDistanceInput(null);
        clearCoincidentFirstOverlay();
        if (!isActive) openGapDistanceFromSelection();
        return;
      }
      // I toggles construction on the selected line(s); O offsets them.  Both are
      // no-ops without a line selection, mirroring the disabled toolbar
      // buttons.
      if (key === "i") {
        e.preventDefault();
        const indices = selectedSketchLineIndices();
        if (indices.length > 0)
          store.toggleSketchShapesDashed(selectedIdRef.current, indices);
        return;
      }
      if (key === "o") {
        e.preventDefault();
        offsetSelectedSketchGeometry(
          selectedIdRef.current,
          selectedSketchLineIndices(),
          e.shiftKey,
        );
        return;
      }

      // C and B are reserved for selection-type toggles (handled above), so the
      // circle / bezier tools have no key bind — use the toolbar.
      const toolMap = {
        l: "line",
        r: "rect",
        e: "ellipse",
        a: "arc",
      };
      const tool = toolMap[key];
      if (tool) {
        e.preventDefault();
        if (sketchDrawRef.current) cancelSketchDraw();
        const current = store.activeSketchTool;
        store.setActiveSketchTool(current === tool ? null : tool);
      }
    }
  };

  return { onKeyDown };
}
