import React, { useState, useRef } from "react";
import { useStore } from "../store";
import { beginChamferRetarget } from "../three/cameraControls/chamferCommit.js";
import { beginPushPullRetarget } from "../three/cameraControls/pushPull.js";
import { beginRevolveRetarget } from "../three/cameraControls/sweep.js";
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

// Detect revolve (sweep) entries — a CREATE whose item carries a revolve recipe.
const revolveInfo = (entry) => {
  const inst = entry?.instruction;
  if (inst?.type !== "create") return null;
  if (inst.item?.regenerator?.kind !== "revolve") return null;
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
};

const CSG_ICONS = {
  union: UnionIcon,
  difference: DifferenceIcon,
  intersection: IntersectionIcon,
};

const entryIcon = (entry) => {
  const ci = chamferInfo(entry);
  if (ci) return ci.isFillet ? <FilletIcon /> : <ChamferIcon />;

  const inst = entry.instruction;
  if (entry.label === "Split") return <SplitIcon />;
  if (entry.label === "Extruded") return <ExtrudeIcon />;

  if (inst?.type === "create") {
    const item = inst.item;
    if (item?.type === "csg") {
      const Icon = CSG_ICONS[item.regenerator?.op];
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

// Retarget + edit-length controls for an extrude entry.  With `groupIds` the
// controls act on a whole multi-area group as one unit; otherwise on the single
// `itemId`.
function ExtrudeActions({ itemId, groupIds }) {
  const extrudeSelectMode = useStore((s) => s.extrudeSelectMode);
  const extrudeRetargetId = useStore((s) => s.extrudeRetargetId);
  const extrudeRetargetGroup = useStore((s) => s.extrudeRetargetGroup);
  const setExtrudeRetargetId = useStore((s) => s.setExtrudeRetargetId);
  const setExtrudeRetargetGroup = useStore((s) => s.setExtrudeRetargetGroup);
  const setExtrudeSelectMode = useStore((s) => s.setExtrudeSelectMode);
  const setExtrudeEditTarget = useStore((s) => s.setExtrudeEditTarget);
  const isGroup = !!groupIds;
  const retargetActive =
    extrudeSelectMode === "profile" &&
    (isGroup
      ? !!extrudeRetargetGroup && extrudeRetargetGroup[0] === groupIds[0]
      : !extrudeRetargetGroup && extrudeRetargetId === itemId);
  return (
    <>
      <button
        className={`timeline-action-btn${retargetActive ? " active" : ""}`}
        title="Retarget Profile — pick the face(s) or sketch region(s) to extrude from"
        onClick={(e) => {
          e.stopPropagation();
          setExtrudeRetargetGroup(isGroup ? groupIds : null);
          setExtrudeRetargetId(isGroup ? groupIds[0] : itemId);
          setExtrudeSelectMode("profile");
        }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14">
          <circle
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle
            cx="12"
            cy="12"
            r="5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
          <line
            x1="12"
            y1="2"
            x2="12"
            y2="4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
          />
          <line
            x1="12"
            y1="20"
            x2="12"
            y2="22"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
          />
          <line
            x1="2"
            y1="12"
            x2="4"
            y2="12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
          />
          <line
            x1="20"
            y1="12"
            x2="22"
            y2="12"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
          />
        </svg>
      </button>
      <button
        className="timeline-action-btn"
        title="Edit extrusion length"
        onClick={(e) => {
          e.stopPropagation();
          setExtrudeEditTarget(
            isGroup ? { groupItemIds: groupIds } : { itemId },
          );
        }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14">
          <line
            x1="3"
            y1="10"
            x2="21"
            y2="10"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
          />
          <line
            x1="3"
            y1="10"
            x2="3"
            y2="16"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="square"
          />
          <line
            x1="21"
            y1="10"
            x2="21"
            y2="16"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="square"
          />
          <line
            x1="3"
            y1="15"
            x2="21"
            y2="15"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="square"
          />
          <polygon
            points="3,15 6,13.5 6,16.5"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="0.5"
          />
          <polygon
            points="21,15 18,13.5 18,16.5"
            fill="currentColor"
            stroke="currentColor"
            strokeWidth="0.5"
          />
        </svg>
      </button>
    </>
  );
}

const Timeline = () => {
  const history = useStore((state) => state.history);
  const activeHistoryId = useStore((state) => state.activeHistoryId);
  const restoreToHistory = useStore((state) => state.restoreToHistory);
  const deleteHistoryEntry = useStore((state) => state.deleteHistoryEntry);
  const reorderHistory = useStore((state) => state.reorderHistory);
  const setChamferEditTarget = useStore((state) => state.setChamferEditTarget);
  const chamferRetargetTarget = useStore(
    (state) => state.chamferRetargetTarget,
  );
  const setPushPullEditTarget = useStore(
    (state) => state.setPushPullEditTarget,
  );
  const pushPullRetargetTarget = useStore(
    (state) => state.pushPullRetargetTarget,
  );
  const setSweepEditTarget = useStore((state) => state.setSweepEditTarget);
  const sweepRetargetTarget = useStore((state) => state.sweepRetargetTarget);
  const selectItem = useStore((state) => state.selectItem);
  const undoCount = useStore((state) => state.undoStack.length);
  const redoCount = useStore((state) => state.redoStack.length);

  const [draggedId, setDraggedId] = useState(null);
  const [dropBeforeId, setDropBeforeId] = useState(undefined);
  const dragCounter = useRef(0);
  const containerRef = useRef(null);

  const activeIndex =
    activeHistoryId !== null
      ? history.findIndex((h) => h.id === activeHistoryId)
      : history.length - 1;

  const handleKeyDown = (e) => {
    if (
      e.key === "ArrowUp" ||
      e.key === "ArrowDown" ||
      e.key === "ArrowLeft" ||
      e.key === "ArrowRight"
    ) {
      e.preventDefault();
      let targetIndex;
      if (e.key === "ArrowUp") targetIndex = Math.max(0, activeIndex - 1);
      else if (e.key === "ArrowDown")
        targetIndex = Math.min(history.length - 1, activeIndex + 1);
      else if (e.key === "ArrowLeft") targetIndex = 0;
      else targetIndex = history.length - 1;
      if (targetIndex !== activeIndex)
        restoreToHistory(history[targetIndex].id);
    }
  };

  const canDelete = (index) => history.length > 1 && index > 0;

  const handleDragStart = (e, id) => {
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
    <div className="timeline">
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
              m.recalculateTimeline();
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
          const isActive = index === activeIndex;
          const isFuture = index > activeIndex;
          const isDragging = entry.id === draggedId;
          const isDropTarget = dropBeforeId === entry.id;
          const isDraggable = index > 0;
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
                restoreToHistory(entry.id);
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
              {entry.instruction?.type === "createGroup" &&
                (() => {
                  const ids = entry.instruction.items
                    .filter((p) => p.type === "extrude")
                    .map((p) => p.id);
                  return ids.length ? <ExtrudeActions groupIds={ids} /> : null;
                })()}
              {chamferInfo(entry) && (
                <>
                  <button
                    className={`timeline-action-btn${
                      chamferRetargetTarget?.itemId === entry.itemId
                        ? " active"
                        : ""
                    }`}
                    title={`Retarget ${
                      chamferInfo(entry).isFillet ? "fillet" : "chamfer"
                    } — adjust the selected face(s)/edge(s) and confirm`}
                    onClick={(e) => {
                      e.stopPropagation();
                      restoreToHistory(entry.id);
                      selectItem(entry.itemId);
                      beginChamferRetarget(entry.itemId, entry.id);
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
                    title={`Edit ${
                      chamferInfo(entry).isFillet ? "fillet" : "chamfer"
                    } parameters`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setChamferEditTarget({ entryId: entry.id });
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14">
                      {chamferInfo(entry).isFillet ? (
                        <path
                          d="M4 4 L13 4 Q20 4 20 11 L20 20 L4 20 Z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinejoin="round"
                        />
                      ) : (
                        <>
                          <path
                            d="M4 4 L14 4 L20 10 L20 20 L4 20 Z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinejoin="round"
                          />
                          <line
                            x1="14"
                            y1="4"
                            x2="20"
                            y2="10"
                            stroke="currentColor"
                            strokeWidth="2"
                          />
                        </>
                      )}
                    </svg>
                  </button>
                </>
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
                    <svg viewBox="0 0 24 24" width="14" height="14">
                      <rect
                        x="6"
                        y="9"
                        width="12"
                        height="6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <line
                        x1="12"
                        y1="2"
                        x2="12"
                        y2="9"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <polygon
                        points="12,2 9.5,5 14.5,5"
                        fill="currentColor"
                        stroke="currentColor"
                        strokeWidth="0.5"
                      />
                      <line
                        x1="12"
                        y1="15"
                        x2="12"
                        y2="22"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <polygon
                        points="12,22 9.5,19 14.5,19"
                        fill="currentColor"
                        stroke="currentColor"
                        strokeWidth="0.5"
                      />
                    </svg>
                  </button>
                </>
              )}
              {revolveInfo(entry) && (
                <>
                  <button
                    className={`timeline-action-btn${
                      sweepRetargetTarget?.itemId === revolveInfo(entry).itemId
                        ? " active"
                        : ""
                    }`}
                    title="Retarget revolve — re-pick the profile and axis"
                    onClick={(e) => {
                      e.stopPropagation();
                      restoreToHistory(entry.id);
                      selectItem(revolveInfo(entry).itemId);
                      beginRevolveRetarget(revolveInfo(entry).itemId, entry.id);
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14">
                      <circle
                        cx="12"
                        cy="12"
                        r="9"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                      <circle cx="12" cy="12" r="2" fill="currentColor" />
                      <line
                        x1="12"
                        y1="1"
                        x2="12"
                        y2="4"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      />
                    </svg>
                  </button>
                  <button
                    className="timeline-action-btn"
                    title="Edit revolve parameters"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSweepEditTarget({ entryId: entry.id });
                    }}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14">
                      <path
                        d="M4 12 A8 8 0 1 1 12 20"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                      <polyline
                        points="4,7 4,12 9,12"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </>
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
      <div className="timeline-undo-status">
        {undoCount > 0 || redoCount > 0
          ? `${undoCount} undo · ${redoCount} redo`
          : "No undo history"}
      </div>
    </div>
  );
};

export default Timeline;
