import React, { useState, useRef, useEffect } from "react";
import { useStore } from "../store";
import { anyToolActive } from "../store/selectionMode.js";
import { beginPushPullRetarget } from "../three/cameraControls/pushPull.js";
import {
  beginRevolveEdit,
  beginPipeRetarget,
  beginLoftRetarget,
} from "../three/cameraControls/sweep.js";
import {
  CubeIcon,
  SphereIcon,
  CylinderIcon,
  TorusIcon,
  SketchPlaneIcon,
  ExtrudeIcon,
  UnionIcon,
  DifferenceIcon,
  IntersectionIcon,
  SplitIcon,
  ChamferIcon,
  FilletIcon,
  ShellIcon,
  HoleIcon,
  EmbossIcon,
  EditIcon,
  PlaneIcon,
  RevolveIcon,
  PipeIcon,
  LoftIcon,
  MirrorIcon,
  CircularPatternIcon,
  RectangularPatternIcon,
} from "./toolbar/timelineIcons.jsx";
import "../styles/Timeline.css";

// Detect chamfer / fillet entries by looking at the instruction payload —
// covers both newly-labelled entries ("Chamfered" / "Filleted") and old
// "Modified" entries written before the label change.
const chamferInfo = (entry) => {
  const inst = entry?.instruction;
  if (inst?.type !== "modify") return null;
  const r = inst.patches?.regenerator;
  if (r?.kind !== "chamfer") return null;
  return { isFillet: r.segments !== 1 };
};

// Detect push/pull entries — a modify whose regenerator is a push/pull op.
const pushPullInfo = (entry) => {
  const inst = entry?.instruction;
  if (inst?.type !== "modify") return null;
  const r = inst.patches?.regenerator;
  if (r?.kind !== "pushpull") return null;
  return { distance: r.distance ?? 0 };
};

// Detect shell entries — a modify whose regenerator is a shell op.
const shellInfo = (entry) => {
  const inst = entry?.instruction;
  if (inst?.type !== "modify") return null;
  const r = inst.patches?.regenerator;
  if (r?.kind !== "shell") return null;
  return { thickness: r.thickness ?? 0 };
};

// Detect hole entries — a modify whose regenerator is a hole op.
const holeInfo = (entry) => {
  const inst = entry?.instruction;
  if (inst?.type !== "modify") return null;
  return inst.patches?.regenerator?.kind === "hole" ? {} : null;
};

const embossInfo = (entry) => {
  const inst = entry?.instruction;
  if (inst?.type !== "modify") return null;
  return inst.patches?.regenerator?.kind === "emboss" ? {} : null;
};

const draftInfo = (entry) => {
  const inst = entry?.instruction;
  if (inst?.type !== "modify") return null;
  return inst.patches?.regenerator?.kind === "draft" ? {} : null;
};

// Detect revolve (sweep) entries — a CREATE whose item carries a revolve recipe.
const revolveInfo = (entry) => {
  const inst = entry?.instruction;
  if (inst?.type !== "create") return null;
  if (inst.item?.regenerator?.kind !== "revolve") return null;
  return { itemId: inst.item.id };
};

const pipeInfo = (entry) => {
  const inst = entry?.instruction;
  if (inst?.type !== "create") return null;
  if (inst.item?.regenerator?.kind !== "pipe") return null;
  return { itemId: inst.item.id };
};

const loftInfo = (entry) => {
  const inst = entry?.instruction;
  if (inst?.type !== "create") return null;
  if (inst.item?.regenerator?.kind !== "loft") return null;
  return { itemId: inst.item.id };
};

// A chamfer/fillet/push-pull whose regen couldn't rebuild after the geometry
// changed (the selected edge/face vanished or OCC rejected it).  The step keeps
// its stale mesh and is flagged bad until the user retargets / re-applies it.
const chamferFailed = (entry) => {
  const r = entry?.instruction?.patches?.regenerator;
  return (
    (r?.kind === "chamfer" || r?.kind === "pushpull") && r.regenFailed === true
  );
};

// The icon a "create"/"createGroup" item type appears as on the Create
// toolbar — keeps the timeline dot recognizable as "the button you pressed".
const CREATE_ICONS = {
  cube: CubeIcon,
  sphere: SphereIcon,
  cylinder: CylinderIcon,
  torus: TorusIcon,
  sketch: SketchPlaneIcon,
  extrude: ExtrudeIcon,
  plane: PlaneIcon,
};

// Sweep / pattern csg items carry a regenerator.kind (no boolean `.op`); map
// those to the tool icon that created them.
const PATTERN3D_ICONS = {
  mirror: MirrorIcon,
  circular: CircularPatternIcon,
  rectangular: RectangularPatternIcon,
};
const REGEN_KIND_ICONS = {
  revolve: RevolveIcon,
  pipe: PipeIcon,
  loft: LoftIcon,
};

const CSG_ICONS = {
  union: UnionIcon,
  difference: DifferenceIcon,
  intersection: IntersectionIcon,
};

const entryIcon = (entry) => {
  const ci = chamferInfo(entry);
  if (ci) return ci.isFillet ? <FilletIcon /> : <ChamferIcon />;
  if (shellInfo(entry)) return <ShellIcon />;
  if (holeInfo(entry)) return <HoleIcon />;
  if (embossInfo(entry)) return <EmbossIcon />;
  if (draftInfo(entry)) return <EmbossIcon />;

  const inst = entry.instruction;
  if (entry.label === "Split") return <SplitIcon />;
  if (entry.label === "Extruded") return <ExtrudeIcon />;

  if (inst?.type === "create") {
    const item = inst.item;
    if (item?.type === "csg") {
      const r = item.regenerator;
      const KindIcon =
        REGEN_KIND_ICONS[r?.kind] ||
        (r?.kind === "pattern3d" ? PATTERN3D_ICONS[r.patternType] : null);
      if (KindIcon) return <KindIcon />;
      const Icon = CSG_ICONS[r?.op];
      if (Icon) return <Icon />;
    }
    const Icon = CREATE_ICONS[item?.type];
    if (Icon) return <Icon />;
  }

  const label = entry.label;
  if (label.startsWith("Deleted")) return "−";
  if (label.startsWith("Moved")) return "↔";
  if (label.startsWith("Rotated")) return "↻";
  if (label.startsWith("Scaled")) return "⤢";
  return "◆";
};

const getItemName = (history, itemId) => {
  for (let i = history.length - 1; i >= 0; i--) {
    const inst = history[i].instruction;
    if (inst.type === "create" && inst.item && inst.item.id === itemId) {
      return inst.item.name;
    }
    if (inst.type === "createGroup" && inst.items) {
      const m = inst.items.find((it) => it.id === itemId);
      if (m) return m.name;
    }
  }
  return `#${itemId}`;
};

const getDisplayLabel = (entry, history) => {
  // Promote legacy "Modified" entries that contain a chamfer regenerator
  // to "Chamfered" / "Filleted" so the label matches the entry's actual
  // operation regardless of when it was recorded.
  const ci = chamferInfo(entry);
  const label =
    ci && entry.label === "Modified"
      ? ci.isFillet
        ? "Filleted"
        : "Chamfered"
      : entry.label;
  // A createGroup step makes several items at once (a multi-area extrude's
  // prisms); name it by count rather than one arbitrary member.
  if (entry.instruction?.type === "createGroup") {
    const n = entry.instruction.items?.length || 0;
    return `${label} ${n} extrusions`;
  }
  if (entry.itemId != null) {
    return `${label} ${getItemName(history, entry.itemId)}`;
  }
  return label;
};

// Edit control for an extrude entry.  Editing re-enters profile-select mode
// seeded with the extrude's current profile, so the user can change the profile
// AND the length and Confirm edits the entry in place (retargetExtrude).  With
// `groupIds` it acts on a whole multi-area group as one unit; otherwise on the
// single `itemId`.
function ExtrudeActions({ itemId, groupIds }) {
  const extrudeSelectMode = useStore((s) => s.extrudeSelectMode);
  const extrudeRetargetId = useStore((s) => s.extrudeRetargetId);
  const extrudeRetargetGroup = useStore((s) => s.extrudeRetargetGroup);
  const setExtrudeRetargetId = useStore((s) => s.setExtrudeRetargetId);
  const setExtrudeRetargetGroup = useStore((s) => s.setExtrudeRetargetGroup);
  const setExtrudeSelectMode = useStore((s) => s.setExtrudeSelectMode);
  const isGroup = !!groupIds;
  const editActive =
    extrudeSelectMode === "profile" &&
    (isGroup
      ? !!extrudeRetargetGroup && extrudeRetargetGroup[0] === groupIds[0]
      : !extrudeRetargetGroup && extrudeRetargetId === itemId);
  return (
    <button
      className={`timeline-action-btn${editActive ? " active" : ""}`}
      title="Edit extrusion — change the profile and length, then Confirm"
      onClick={(e) => {
        e.stopPropagation();
        // Enter profile mode FIRST: setExtrudeSelectMode spreads
        // TOOL_RESET_PATCH when freshly entering extrude, which nulls
        // extrudeRetargetId/Group — so arming the edit target before it would
        // be wiped, and Confirm would build a NEW extrude instead of editing.
        setExtrudeSelectMode("profile");
        setExtrudeRetargetGroup(isGroup ? groupIds : null);
        setExtrudeRetargetId(isGroup ? groupIds[0] : itemId);
      }}
    >
      <EditIcon />
    </button>
  );
}

const Timeline = () => {
  const history = useStore((state) => state.history);
  const activeHistoryId = useStore((state) => state.activeHistoryId);
  const restoreToHistory = useStore((state) => state.restoreToHistory);
  const deleteHistoryEntry = useStore((state) => state.deleteHistoryEntry);
  const reorderHistory = useStore((state) => state.reorderHistory);
  const setChamferEditTarget = useStore((state) => state.setChamferEditTarget);
  const setPushPullEditTarget = useStore(
    (state) => state.setPushPullEditTarget,
  );
  const setShellTarget = useStore((state) => state.setShellTarget);
  const beginHoleEdit = useStore((state) => state.beginHoleEdit);
  const beginEmbossEdit = useStore((state) => state.beginEmbossEdit);
  const beginDraftEdit = useStore((state) => state.beginDraftEdit);
  const openBoxDialog = useStore((state) => state.openBoxDialog);
  const pushPullRetargetTarget = useStore(
    (state) => state.pushPullRetargetTarget,
  );
  const sweepRetargetTarget = useStore((state) => state.sweepRetargetTarget);
  const selectItem = useStore((state) => state.selectItem);
  const undoCount = useStore((state) => state.undoStack.length);
  const redoCount = useStore((state) => state.redoStack.length);
  // While a create/modify/sketch tool is mid-flow — or a sketch is open for
  // editing — lock the timeline: jumping history out from under it corrupts what
  // it's targeting (and a sketch edit re-runs downstream steps on close anyway).
  const editingSketch = useStore((s) => {
    const it = s.items.find((i) => i.id === s.selectedId);
    return it?.type === "sketch";
  });
  const toolLocked = useStore(anyToolActive) || editingSketch;

  const [draggedId, setDraggedId] = useState(null);
  const [dropBeforeId, setDropBeforeId] = useState(undefined);
  const dragCounter = useRef(0);
  const containerRef = useRef(null);

  const activeIndex =
    activeHistoryId !== null
      ? history.findIndex((h) => h.id === activeHistoryId)
      : history.length - 1;

  // Restoring a step rebuilds geometry, so scrubbing fast (held arrows, rapid
  // clicks) would fire a rebuild per step.  Move the cursor instantly via a local
  // `navIndex` for the highlight + scroll, but DEBOUNCE the actual restore so only
  // the step you settle on rebuilds.
  const [navIndex, setNavIndex] = useState(null);
  const navTimer = useRef(null);
  const displayIndex = Math.min(
    history.length - 1,
    navIndex != null ? navIndex : activeIndex,
  );

  const navigateTo = (targetIndex) => {
    if (toolLocked || targetIndex < 0 || targetIndex >= history.length) return;
    if (targetIndex === displayIndex) return;
    setNavIndex(targetIndex); // move the cursor now
    if (navTimer.current) clearTimeout(navTimer.current);
    navTimer.current = setTimeout(() => {
      navTimer.current = null;
      restoreToHistory(history[targetIndex].id); // rebuild once you settle
    }, 150);
  };

  // Reconcile the local cursor once a restore lands (or history changes from
  // elsewhere — undo/redo, a new step, a delete).
  useEffect(() => {
    setNavIndex(null);
  }, [activeHistoryId, history.length]);
  useEffect(
    () => () => {
      if (navTimer.current) clearTimeout(navTimer.current);
    },
    [],
  );

  // Keep the active step in view as it moves (arrow nav / restore / a new step).
  // Priority: the active row must be visible; then the two AFTER it; then, if
  // they still fit, the two BEFORE it — so context is shown around the cursor.
  useEffect(() => {
    const c = containerRef.current;
    if (!c || displayIndex < 0) return;
    const rows = c.querySelectorAll(".timeline-entry");
    const active = rows[displayIndex];
    if (!active) return;
    const at = (i) => rows[Math.max(0, Math.min(rows.length - 1, i))];
    const cr = c.getBoundingClientRect();
    const top = (el) => el.getBoundingClientRect().top - cr.top + c.scrollTop;
    const bot = (el) =>
      el.getBoundingClientRect().bottom - cr.top + c.scrollTop;
    const H = c.clientHeight;
    const viewBot = c.scrollTop + H;
    const afterBot = bot(at(displayIndex + 2));
    const activeTop = top(active);
    const beforeTop = top(at(displayIndex - 2));
    let next = c.scrollTop;
    if (afterBot > viewBot) next = afterBot - H; // reveal the two following
    if (activeTop < next) next = activeTop; // but never scroll the active out
    if (beforeTop < next && afterBot - beforeTop <= H) next = beforeTop; // + before
    next = Math.max(0, next);
    if (Math.abs(next - c.scrollTop) > 1)
      c.scrollTo({ top: next, behavior: "smooth" });
  }, [displayIndex, history.length]);

  const handleKeyDown = (e) => {
    if (toolLocked) return;
    if (
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight"
    ) {
      e.preventDefault();
      let targetIndex;
      if (e.key === "ArrowUp") targetIndex = Math.max(0, displayIndex - 1);
      else if (e.key === "ArrowDown")
        targetIndex = Math.min(history.length - 1, displayIndex + 1);
      else if (e.key === "ArrowLeft") targetIndex = 0;
      else targetIndex = history.length - 1;
      navigateTo(targetIndex);
    }
  };

  const canDelete = (index) => history.length > 1 && index > 0;

  const handleDragStart = (e, id) => {
    if (toolLocked) {
      e.preventDefault();
      return;
    }
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(id));
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDropBeforeId(undefined);
    dragCounter.current = 0;
  };

  const handleDragOver = (e, id, index) => {
    if (draggedId === null || index === 0) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      setDropBeforeId(id);
    } else {
      const nextEntry = history[index + 1];
      setDropBeforeId(nextEntry ? nextEntry.id : null);
    }
  };

  const handleDrop = (e, index) => {
    if (index === 0) return;
    e.preventDefault();
    if (draggedId !== null && dropBeforeId !== undefined) {
      reorderHistory(draggedId, dropBeforeId);
    }
    setDraggedId(null);
    setDropBeforeId(undefined);
  };

  const handleEndZoneDragOver = (e) => {
    if (draggedId === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropBeforeId(null);
  };

  const handleEndZoneDrop = (e) => {
    e.preventDefault();
    if (draggedId !== null) {
      reorderHistory(draggedId, null);
    }
    setDraggedId(null);
    setDropBeforeId(undefined);
  };

  return (
    <div
      className={`timeline${toolLocked ? " tool-locked" : ""}`}
      // Lock the whole area while a tool is mid-flow: every button (step
      // restore, edit/retarget/delete, recalculate, reorder) is disabled, not
      // just history navigation.  aria-disabled mirrors it for assistive tech.
      aria-disabled={toolLocked || undefined}
    >
      <div className="timeline-header">
        <span>Timeline</span>
        <button
          className="timeline-recalc-btn"
          title="Recalculate every step from the beginning"
          onClick={() => {
            // Lazy-import so the orchestrator module isn't pulled into
            // the worker's transitive graph (see regenerateOrchestrator.js
            // for the cycle constraint).
            import("../three/regenerateOrchestrator.js").then((m) => {
              // force=true: rebuild EVERY step from the beginning, ignoring the
              // incremental valid-cache skip — the button's whole purpose.
              m.recalculateTimeline(true);
            });
          }}
        >
          <svg viewBox="0 0 24 24" width="14" height="14">
            {/* Circular refresh arrow */}
            <path
              d="M4 12 a8 8 0 0 1 14-5.7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <polyline
              points="18,2 18,7 13,7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M20 12 a8 8 0 0 1 -14 5.7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <polyline
              points="6,22 6,17 11,17"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <div
        ref={containerRef}
        className="timeline-content"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {history.map((entry, index) => {
          const isActive = index === displayIndex;
          const isFuture = index > displayIndex;
          const isDragging = entry.id === draggedId;
          const isDropTarget = dropBeforeId === entry.id;
          const isDraggable = index > 0 && !toolLocked;
          const failed = chamferFailed(entry);

          return (
            <div
              key={entry.id}
              className={[
                "timeline-entry",
                isActive ? "active" : "",
                isFuture ? "future" : "",
                entry._orphaned ? "orphaned" : "",
                failed ? "failed" : "",
                isDragging ? "dragging" : "",
                isDropTarget ? "drop-before" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              draggable={isDraggable}
              onDragStart={
                isDraggable ? (e) => handleDragStart(e, entry.id) : undefined
              }
              onDragEnd={isDraggable ? handleDragEnd : undefined}
              onDragOver={(e) => handleDragOver(e, entry.id, index)}
              onDrop={(e) => handleDrop(e, index)}
              onClick={() => {
                // Locked while a tool is mid-flow — navigating history would pull
                // the geometry the tool targets out from under it.
                if (toolLocked) return;
                navigateTo(index);
                containerRef.current?.focus();
              }}
            >
              <div className="timeline-track">
                <div className={`timeline-dot${isActive ? " active" : ""}`}>
                  {entryIcon(entry)}
                </div>
                {index < history.length - 1 && (
                  <div className="timeline-line" />
                )}
              </div>
              {isDraggable && (
                <span className="timeline-drag-handle" aria-hidden="true">
                  ⠿
                </span>
              )}
              <span className="timeline-label">
                {getDisplayLabel(entry, history)}
              </span>
              {failed && (
                <span
                  className="timeline-failed-badge"
                  title="This chamfer/fillet couldn't rebuild after the geometry changed — its edge/face is gone or OCC rejected it. Retarget (re-apply) or edit it to fix; the shown shape is stale."
                >
                  ⚠
                </span>
              )}
              {entry.instruction?.type === "create" &&
                entry.instruction.item?.type === "extrude" && (
                  <ExtrudeActions itemId={entry.instruction.item.id} />
                )}
              {entry.instruction?.type === "create" &&
                ["cube", "sphere", "cylinder", "torus", "cone"].includes(
                  entry.instruction.item?.type,
                ) && (
                  <button
                    className="timeline-action-btn"
                    title="Edit dimensions"
                    onClick={(e) => {
                      e.stopPropagation();
                      openBoxDialog(entry.instruction.item.id);
                    }}
                  >
                    <EditIcon />
                  </button>
                )}
              {entry.instruction?.type === "createGroup" &&
                (() => {
                  const ids = entry.instruction.items
                    .filter((p) => p.type === "extrude")
                    .map((p) => p.id);
                  return ids.length ? <ExtrudeActions groupIds={ids} /> : null;
                })()}
              {chamferInfo(entry) && (
                <button
                  className="timeline-action-btn"
                  title={`Edit ${
                    chamferInfo(entry).isFillet ? "fillet" : "chamfer"
                  } parameters`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setChamferEditTarget({ entryId: entry.id });
                  }}
                >
                  <EditIcon />
                </button>
              )}
              {pushPullInfo(entry) && (
                <>
                  <button
                    className={`timeline-action-btn${
                      pushPullRetargetTarget?.itemId === entry.itemId
                        ? " active"
                        : ""
                    }`}
                    title="Retarget push/pull — adjust the selected face(s) and confirm"
                    onClick={(e) => {
                      e.stopPropagation();
                      restoreToHistory(entry.id);
                      selectItem(entry.itemId);
                      beginPushPullRetarget(entry.itemId, entry.id);
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14">
                      <rect
                        x="3"
                        y="14"
                        width="12"
                        height="7"
                        rx="1"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <polygon
                        points="3,14 6,9 18,9 18,14"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        opacity="0.6"
                      />
                      <circle
                        cx="19"
                        cy="5"
                        r="3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <circle cx="19" cy="5" r="1" fill="currentColor" />
                    </svg>
                  </button>
                  <button
                    className="timeline-action-btn"
                    title="Edit push/pull distance"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPushPullEditTarget({ entryId: entry.id });
                    }}
                  >
                    <EditIcon />
                  </button>
                </>
              )}
              {shellInfo(entry) && (
                <button
                  className="timeline-action-btn"
                  title="Edit shell thickness"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShellTarget({ itemId: entry.itemId, entryId: entry.id });
                  }}
                >
                  <EditIcon />
                </button>
              )}
              {holeInfo(entry) && (
                <button
                  className="timeline-action-btn"
                  title="Edit hole — length / thread / diameter / tolerance"
                  onClick={(e) => {
                    e.stopPropagation();
                    restoreToHistory(entry.id);
                    beginHoleEdit(entry.id);
                  }}
                >
                  <EditIcon />
                </button>
              )}
              {embossInfo(entry) && (
                <button
                  className="timeline-action-btn"
                  title="Edit emboss — mode / angle / offset / scale / depth"
                  onClick={(e) => {
                    e.stopPropagation();
                    restoreToHistory(entry.id);
                    beginEmbossEdit(entry.id);
                  }}
                >
                  <EditIcon />
                </button>
              )}
              {draftInfo(entry) && (
                <button
                  className="timeline-action-btn"
                  title="Edit draft — angle / flip / faces"
                  onClick={(e) => {
                    e.stopPropagation();
                    restoreToHistory(entry.id);
                    beginDraftEdit(entry.id);
                  }}
                >
                  <EditIcon />
                </button>
              )}
              {revolveInfo(entry) && (
                <button
                  className={`timeline-action-btn${
                    sweepRetargetTarget?.itemId === revolveInfo(entry).itemId
                      ? " active"
                      : ""
                  }`}
                  title="Edit revolve — change parameters, re-pick the profile or axis"
                  onClick={(e) => {
                    e.stopPropagation();
                    restoreToHistory(entry.id);
                    selectItem(revolveInfo(entry).itemId);
                    beginRevolveEdit(revolveInfo(entry).itemId, entry.id);
                  }}
                >
                  <EditIcon />
                </button>
              )}
              {pipeInfo(entry) && (
                <button
                  className={`timeline-action-btn${
                    sweepRetargetTarget?.itemId === pipeInfo(entry).itemId
                      ? " active"
                      : ""
                  }`}
                  title="Retarget pipe — re-pick the profile and path"
                  onClick={(e) => {
                    e.stopPropagation();
                    restoreToHistory(entry.id);
                    selectItem(pipeInfo(entry).itemId);
                    beginPipeRetarget(pipeInfo(entry).itemId, entry.id);
                  }}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path
                      d="M5 19 L5 10 C5 8, 6 7, 8 7 L19 7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <circle cx="5" cy="19" r="2" fill="currentColor" />
                  </svg>
                </button>
              )}
              {loftInfo(entry) && (
                <button
                  className={`timeline-action-btn${
                    sweepRetargetTarget?.itemId === loftInfo(entry).itemId
                      ? " active"
                      : ""
                  }`}
                  title="Retarget loft — re-pick the two profile regions"
                  onClick={(e) => {
                    e.stopPropagation();
                    restoreToHistory(entry.id);
                    selectItem(loftInfo(entry).itemId);
                    beginLoftRetarget(loftInfo(entry).itemId, entry.id);
                  }}
                >
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <rect
                      x="9"
                      y="3"
                      width="6"
                      height="3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <rect
                      x="4"
                      y="18"
                      width="16"
                      height="3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <line
                      x1="9"
                      y1="6"
                      x2="4"
                      y2="18"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                    <line
                      x1="15"
                      y1="6"
                      x2="20"
                      y2="18"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    />
                  </svg>
                </button>
              )}
              {canDelete(index) && (
                <button
                  className="timeline-delete-btn"
                  title="Delete entry"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteHistoryEntry(entry.id);
                  }}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        <div
          className={`timeline-drop-end${dropBeforeId === null ? " active" : ""}`}
          onDragOver={handleEndZoneDragOver}
          onDrop={handleEndZoneDrop}
        />
      </div>
      <button
        className="timeline-end-btn"
        title="Jump to the latest step (end of the timeline)"
        disabled={toolLocked || displayIndex >= history.length - 1}
        onClick={() => {
          if (toolLocked || history.length === 0) return;
          navigateTo(history.length - 1);
          containerRef.current?.focus();
        }}
      >
        <svg viewBox="0 0 24 24" width="13" height="13">
          <polyline
            points="6,4 12,10 18,4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="6,11 12,17 18,11"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <line
            x1="6"
            y1="20"
            x2="18"
            y2="20"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
        <span>Move to end</span>
      </button>
      <div className="timeline-undo-status">
        {undoCount > 0 || redoCount > 0
          ? `${undoCount} undo · ${redoCount} redo`
          : "No undo history"}
      </div>
    </div>
  );
};

export default Timeline;
