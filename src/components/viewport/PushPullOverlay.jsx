// Push/pull: the bottom-bar dialog the other Modify tools use (overlayBar.js),
// for all three ways in -- the toolbar button (pushPullSelectMode), Retarget
// from the timeline (the prior faces pre-selected, pushPullRetargetTarget) and
// Edit from the timeline (pushPullEditTarget: the step's distance, saved in
// place).  The picked faces are highlighted in the viewport; a debounced call
// into pushPull.js swaps in a translucent preview of the result.
//
// The distance is how far the faces move along their own normals: out (a
// pull, growing the body) unless Flip pushes them in.  A negative distance
// pushes too.  A preview or commit that fails says why on the tool error line.

import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import { commitPushPull } from "../../three/cameraControls/pushPull.js";
import { MM_PER_UNIT } from "../../three/sceneObjects.js";
import { activePrecision } from "../../three/resolution.js";
import FormulaInput from "../FormulaInput";
import ToolErrorLine from "../ToolErrorLine.jsx";
import { evalValue, useDebouncedPreview, useEscapeKey } from "../inputs.jsx";
import {
  BAR_STYLE,
  Field,
  barInput,
  barBtn,
  pickBtn,
  toggleBtn,
} from "./overlayBar.js";

const DISTANCE_HINT =
  "How far the faces move along their own normals: out, growing the body, or in with Flip (or a negative value).";

const setToolError = (toolError) => useStore.setState({ toolError });

export default function PushPullOverlay() {
  const pushPullSelectMode = useStore((s) => s.pushPullSelectMode);
  const setPushPullSelectMode = useStore((s) => s.setPushPullSelectMode);
  const selectedSubGeometry = useStore((s) => s.selectedSubGeometry);
  const clearSelectedSubGeometry = useStore((s) => s.clearSelectedSubGeometry);
  const items = useStore((s) => s.items);
  const history = useStore((s) => s.history);
  const variables = useStore((s) => s.variables);
  const printPrecision = useStore(activePrecision);
  const retargetTarget = useStore((s) => s.pushPullRetargetTarget);
  const setRetargetTarget = useStore((s) => s.setPushPullRetargetTarget);
  const editTarget = useStore((s) => s.pushPullEditTarget);
  const setEditTarget = useStore((s) => s.setPushPullEditTarget);
  const updatePushPullParams = useStore((s) => s.updatePushPullParams);

  const editEntry =
    editTarget?.entryId != null
      ? history.find((h) => h.id === editTarget.entryId)
      : null;
  const editRegen = editEntry?.instruction?.patches?.regenerator;
  const editing = editRegen?.kind === "pushpull";
  const open = !!pushPullSelectMode || editing;

  const [distanceMm, setDistanceMm] = useState("1");
  const [flip, setFlip] = useState(false);

  // Edit and Retarget start from the step's own distance, so Confirm with no
  // change reproduces it; a fresh push/pull starts at 1 mm out.
  const seed = (distance) => {
    const mm = (distance ?? 0.1) * MM_PER_UNIT;
    setDistanceMm(String(Math.abs(mm)));
    setFlip(mm < 0);
  };
  useEffect(() => {
    if (editing) seed(editRegen.distance);
  }, [editTarget?.entryId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!retargetTarget) return;
    const prior = items.find(
      (i) => i.id === retargetTarget.itemId,
    )?.regenerator;
    if (prior?.kind === "pushpull") seed(prior.distance);
  }, [retargetTarget]); // eslint-disable-line react-hooks/exhaustive-deps

  const nFaces = editing
    ? (editRegen.subGeo?.faces?.length ?? 0)
    : (selectedSubGeometry?.faces?.length ?? 0);
  const typed = evalValue(distanceMm, variables); // mm
  const valid = Number.isFinite(typed) && typed !== 0;
  const distance = flip ? -typed : typed; // signed mm, + = out
  const ready = valid && nFaces > 0;

  useDebouncedPreview(
    open && ready,
    () => {
      const cc = useStore.getState()._cameraControls;
      if (editing)
        cc?.updatePushPullEditPreview?.(editRegen, distance, editEntry.itemId);
      else cc?.updatePushPullPreview?.(distance);
    },
    () => useStore.getState()._cameraControls?.clearPushPullPreview?.(),
    [distance, selectedSubGeometry, editing, editRegen],
  );

  // The distance, focused with its text selected as the bar opens, so typing
  // replaces the default (as Extrude's does).
  const distanceRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      distanceRef.current?.focus();
      distanceRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [open, editTarget?.entryId]);

  useEffect(
    () => () => useStore.getState()._cameraControls?.clearPushPullPreview?.(),
    [],
  );

  const close = () => {
    useStore.getState()._cameraControls?.clearPushPullPreview?.();
    setToolError(null);
    if (editing) {
      setEditTarget(null);
      return;
    }
    clearSelectedSubGeometry();
    setPushPullSelectMode(null);
    setRetargetTarget(null);
  };
  useEscapeKey(open, close);

  if (!open) return null;

  const confirm = async () => {
    if (!ready) return;
    if (editing) {
      updatePushPullParams(editEntry.id, { distance: distance / MM_PER_UNIT });
      close();
      return;
    }
    const item = items.find((i) => i.id === selectedSubGeometry.itemId);
    if (!item) return;
    try {
      const ok = await commitPushPull({
        item,
        items,
        selectedSubGeometry,
        distanceMm: distance,
        printPrecision,
      });
      if (!ok) {
        setToolError(
          "Push/pull made nothing — try a smaller distance, or other faces.",
        );
        return;
      }
      setToolError(null);
      setPushPullSelectMode(null);
    } catch (err) {
      setToolError(err.message);
    }
  };

  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") confirm();
    else if (e.key === "Escape") close();
  };

  const hint = editing
    ? "Change the distance, then Confirm · Esc to cancel"
    : nFaces === 0
      ? "Alt+click the faces to push or pull · Shift+Alt+click adds more · Esc to cancel"
      : "Set the distance, then Confirm · Shift+Alt+click adds or removes faces · Esc to cancel";

  return (
    <>
      <div className="sketch-placement-hint">{hint}</div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        <button
          type="button"
          style={pickBtn(!editing, editing)}
          disabled={editing}
          onClick={clearSelectedSubGeometry}
          title={
            editing
              ? "Use Retarget on the timeline step to change the faces"
              : nFaces > 0
                ? "The picked faces · click to clear them and start again"
                : "Alt+click the faces to push or pull"
          }
        >
          {`Faces (${nFaces})`}
        </button>
        <Field
          label="Distance (mm)"
          style={{ marginLeft: 10 }}
          hint={DISTANCE_HINT}
        >
          <FormulaInput
            ref={distanceRef}
            variables={variables}
            value={distanceMm}
            onChange={(e) => setDistanceMm(e.target.value)}
            onKeyDown={onKey}
            style={barInput(valid)}
          />
        </Field>
        <button
          type="button"
          style={{ ...toggleBtn(flip), marginLeft: 4 }}
          aria-pressed={flip}
          onClick={() => setFlip(!flip)}
          title="Flip: push the faces in instead of pulling them out"
        >
          Flip
        </button>
        <button type="button" onClick={close} title="Cancel" style={barBtn()}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!ready}
          title={
            ready
              ? "Confirm — apply the push/pull"
              : nFaces === 0
                ? "Pick the faces first"
                : "Enter a valid distance"
          }
          style={barBtn(true, !ready)}
        >
          Confirm
        </button>
      </div>
      <ToolErrorLine />
    </>
  );
}
