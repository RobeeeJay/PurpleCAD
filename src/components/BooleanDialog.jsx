import { useState, useEffect } from "react";
import { useStore } from "../store";
import { useEscapeKey, useDebouncedPreview } from "./inputs.jsx";
import { BAR_STYLE, barBtn, pickBtn } from "./viewport/overlayBar.js";
import { performCsg, withCommitGuard } from "../three/occClient.js";
import { openMeshNotice } from "../three/importWeld.js";
import { activePrecision } from "../three/resolution.js";
import { maxItemId } from "../store/internals.js";

const SOLID_TYPES = [
  "cube",
  "sphere",
  "cylinder",
  "torus",
  "cone",
  "extrude",
  "csg",
];
const isSolid = (item) => item && SOLID_TYPES.includes(item.type);

// User-facing name of each operation (the OCC op key "difference" reads as
// "Cut").  Used for the hint, the Confirm tooltip and the result item's name.
const OP_NAME = {
  union: "Union",
  difference: "Cut",
  intersection: "Intersection",
};

// Per-operation button copy.  Union / Intersection pick one set of objects;
// Difference splits it into the base ("Object to cut") and the cutters.
const OP_LABELS = {
  union: { primary: "Select objects", secondary: null },
  intersection: { primary: "Select objects", secondary: null },
  difference: { primary: "Object to cut", secondary: "Cutting objects" },
};

// Boolean dialog (Union / Difference / Intersection): pick the primary object(s)
// — and, for a Difference, the cutting objects — by clicking in the 3D view /
// objects list, then confirm.  Object picking reuses the normal viewport
// selection; the lit "Select …" button decides which set a click feeds.
const BooleanDialog = () => {
  const booleanTool = useStore((s) => s.booleanTool);
  const cancelBooleanTool = useStore((s) => s.cancelBooleanTool);
  const selectedIds = useStore((s) => s.selectedIds);
  const setSelection = useStore((s) => s.setSelection);
  const setAdditiveObjectPick = useStore((s) => s.setAdditiveObjectPick);
  const setBooleanCutIds = useStore((s) => s.setBooleanCutIds);
  const items = useStore((s) => s.items);
  const addItem = useStore((s) => s.addItem);
  const consumeItems = useStore((s) => s.consumeItems);
  const printPrecision = useStore(activePrecision);

  const operation = booleanTool?.operation ?? "union";
  const open = !!booleanTool;
  const hasSecondary = !!OP_LABELS[operation].secondary;

  const [primaryIds, setPrimaryIds] = useState([]);
  const [secondaryIds, setSecondaryIds] = useState([]);
  // Which set the next viewport click contributes to.
  const [pick, setPick] = useState("primary");

  // Seed the primary set from the current selection when the dialog opens, and
  // start with the primary button lit (pre-selected when nothing is picked).
  useEffect(() => {
    if (!open) return;
    const sel = useStore.getState().selectedIds;
    const its = useStore.getState().items;
    const solids = sel.filter((id) => isSolid(its.find((i) => i.id === id)));
    // Difference cuts from a single base object; the others take the whole set.
    setPrimaryIds(hasSecondary ? solids.slice(0, 1) : solids);
    setSecondaryIds([]);
    setPick("primary");
  }, [open, operation]); // eslint-disable-line react-hooks/exhaustive-deps

  // A plain click adds/toggles for the multi-object sets, but Difference's base
  // ("Object to cut") is a single object, so there a plain click should replace.
  useEffect(() => {
    if (!open) return;
    setAdditiveObjectPick(!(hasSecondary && pick === "primary"));
  }, [open, pick, hasSecondary, setAdditiveObjectPick]);

  // Publish the cutting objects so the 3D view can tint them red (Cut only).
  useEffect(() => {
    setBooleanCutIds(open && hasSecondary ? secondaryIds : []);
  }, [open, hasSecondary, secondaryIds, setBooleanCutIds]);

  // Capture viewport selection changes into whichever set is being picked.
  useEffect(() => {
    if (!open) return;
    const solids = selectedIds.filter((id) =>
      isSolid(items.find((i) => i.id === id)),
    );
    if (pick === "primary") {
      setPrimaryIds(hasSecondary ? solids.slice(0, 1) : solids);
    } else {
      // Cutters can't include the base object.
      setSecondaryIds(solids.filter((id) => !primaryIds.includes(id)));
    }
  }, [selectedIds, pick, open, items]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cut mode: once the single base object is chosen, advance to picking the
  // cutting objects automatically (instead of re-toggling the base).  The base
  // stays in the selection so it keeps its highlight while cutters are added.
  useEffect(() => {
    if (!open || !hasSecondary) return;
    if (pick === "primary" && primaryIds.length === 1) {
      setPick("secondary");
      setSelection([...primaryIds, ...secondaryIds]);
    }
  }, [open, hasSecondary, pick, primaryIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const orderedItems = () => {
    const byId = (id) => items.find((i) => i.id === id);
    if (hasSecondary) {
      const base = byId(primaryIds[0]);
      const cutters = secondaryIds.map(byId).filter(Boolean);
      return base ? [base, ...cutters] : [];
    }
    return primaryIds.map(byId).filter(Boolean);
  };

  const valid = hasSecondary
    ? primaryIds.length === 1 && secondaryIds.length >= 1
    : primaryIds.length >= 2;

  const close = () => {
    useStore.getState()._cameraControls?.clearBooleanPreview?.();
    cancelBooleanTool();
  };
  useEscapeKey(open, close);

  // Live ghost of the boolean result, debounced (each rebuild is a full OCC
  // op).  Reuses the pattern ghost renderer (a generic translucent
  // {geometryData, position} overlay).
  useDebouncedPreview(
    open && valid,
    async () => {
      const cc = useStore.getState()._cameraControls;
      const ordered = orderedItems();
      if (ordered.length === 0) {
        cc?.clearBooleanPreview?.();
        return;
      }
      // Dropped if the dialog closes, or a newer preview starts, first.
      const token = cc?.beginToolPreview?.();
      try {
        const result = await performCsg({
          selectedItems: ordered,
          operation,
          printPrecision,
          allItems: items,
        });
        if (result)
          cc?.previewBoolean?.(
            result,
            ordered.map((i) => i.id),
            token,
          );
        else cc?.clearBooleanPreview?.();
      } catch {
        cc?.clearBooleanPreview?.();
      }
    },
    () => useStore.getState()._cameraControls?.clearBooleanPreview?.(),
    [open, valid, operation, primaryIds.join(","), secondaryIds.join(",")],
  );
  // Belt-and-braces: drop the ghost + restore opacity if the tool unmounts or
  // closes some other way.
  useEffect(
    () => () => useStore.getState()._cameraControls?.clearBooleanPreview?.(),
    [booleanTool],
  );

  if (!open) return null;

  // Re-highlight the already-captured set so switching between the buttons
  // doesn't start blank.
  const pickPrimary = () => {
    setPick("primary");
    setSelection(primaryIds);
  };
  const pickSecondary = () => {
    setPick("secondary");
    // Keep the base object lit alongside the cutters so it stays visible while
    // picking; the capture effect still excludes it from the cutter set.
    setSelection([...primaryIds, ...secondaryIds]);
  };

  const finish = (id) => {
    if (id != null) useStore.getState().selectItem?.(id);
    close();
  };

  const confirm = async () => {
    if (!valid) return;
    const ordered = orderedItems();
    // The result inherits the primary object's material (for a difference that's
    // the object being cut from).  Omitted when it uses the default material.
    const primaryMaterial = ordered[0]?.material;
    const opLabel = OP_NAME[operation];
    // Checked before the boolean, shown once its result is committed.
    const notice = await openMeshNotice(ordered);
    const warn = () => notice && useStore.getState().showNotification(notice);
    try {
      // Imported meshes go through OCC too.  They used to take a three-bvh-
      // csg mesh boolean, 30-100x faster but never closed: two overlapping
      // spheres came back with 700-3,200 open edges along the intersection
      // curve, where OCC's result had none -- and with no recipe, so it never
      // rebuilt.  A mesh too dense for OCC is refused with an offer to
      // simplify it (the notification below).
      // Guarded: this dialog previews on a debounce, and a preview that
      // supersedes mid-commit calls cancelOcc, which aborts the REAL op and
      // hands back an empty mesh.  A slow fuse (a swept handle onto a spun cup)
      // landed a 0-triangle body that way, with no error anywhere -- the same
      // failure the hole/shell/emboss commits are guarded against.
      const result = await withCommitGuard(() =>
        performCsg({
          selectedItems: ordered,
          operation,
          printPrecision,
          allItems: items,
        }),
      );
      if (!result) {
        useStore.getState().showNotification(`${opLabel} produced nothing.`);
        return;
      }
      const id = maxItemId(useStore.getState().history) + 1;
      addItem({
        id,
        name: `${opLabel} ${id}`,
        type: "csg",
        children: [],
        position: result.position,
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        geometryData: result.geometryData,
        ...(primaryMaterial && { material: primaryMaterial }),
        // Recipe for re-running this boolean at a different resolution.
        regenerator: {
          kind: "boolean",
          op: operation,
          inputIds: ordered.map((i) => i.id),
          originalCenter: result.position,
          regeneratedAt: printPrecision,
        },
      });
      consumeItems(ordered.map((i) => i.id));
      finish(id);
      warn();
    } catch (err) {
      console.error("CSG operation failed:", err);
      useStore.getState().showNotification(`${opLabel} failed: ${err.message}`);
    }
  };

  const setLabel = (ids) =>
    ids.length === 0
      ? "none"
      : ids.length === 1
        ? (items.find((i) => i.id === ids[0])?.name ?? "1 object")
        : `${ids.length} objects`;

  return (
    <>
      <div className="sketch-placement-hint">
        {OP_NAME[operation]}: click objects in the view to add (click again to
        remove) · the lit button is what your clicks pick · Esc to cancel
      </div>
      <div className="sketch-distance-input-overlay" style={BAR_STYLE}>
        <button
          type="button"
          style={pickBtn(pick === "primary")}
          onClick={pickPrimary}
          title={OP_LABELS[operation].primary}
        >
          {OP_LABELS[operation].primary}: {setLabel(primaryIds)}
        </button>
        {hasSecondary && (
          <button
            type="button"
            // Enabled only once the base object to cut has been chosen.
            disabled={primaryIds.length === 0}
            style={pickBtn(pick === "secondary", primaryIds.length === 0)}
            onClick={pickSecondary}
            title={
              primaryIds.length === 0
                ? "Pick the object to cut first"
                : OP_LABELS[operation].secondary
            }
          >
            {OP_LABELS[operation].secondary}: {setLabel(secondaryIds)}
          </button>
        )}
        <button type="button" onClick={close} title="Cancel" style={barBtn()}>
          Cancel
        </button>
        <button
          type="button"
          onClick={confirm}
          disabled={!valid}
          title={
            valid
              ? `Apply ${OP_NAME[operation]}`
              : hasSecondary
                ? "Pick an object to cut and at least one cutting object"
                : "Pick at least two objects"
          }
          style={barBtn(true, !valid)}
        >
          Confirm
        </button>
      </div>
    </>
  );
};

export default BooleanDialog;
