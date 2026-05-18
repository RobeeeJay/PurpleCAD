import React, { useState, useRef } from "react";
import { useStore } from "../store";
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

const entryIcon = (label) => {
  if (label.startsWith("Added")) return "+";
  if (label.startsWith("Deleted")) return "−";
  if (label.startsWith("Moved")) return "↔";
  if (label.startsWith("Rotated")) return "↻";
  if (label.startsWith("Scaled")) return "⤢";
  if (label.startsWith("Chamfered") || label.startsWith("Filleted"))
    return "◆";
  return "◆";
};

const getItemName = (history, itemId) => {
  for (let i = history.length - 1; i >= 0; i--) {
    const inst = history[i].instruction;
    if (inst.type === "create" && inst.item && inst.item.id === itemId) {
      return inst.item.name;
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
  if (entry.itemId != null) {
    return `${label} ${getItemName(history, entry.itemId)}`;
  }
  return label;
};

const Timeline = () => {
  const history = useStore((state) => state.history);
  const activeHistoryId = useStore((state) => state.activeHistoryId);
  const restoreToHistory = useStore((state) => state.restoreToHistory);
  const deleteHistoryEntry = useStore((state) => state.deleteHistoryEntry);
  const reorderHistory = useStore((state) => state.reorderHistory);
  const setExtrudeRetargetId = useStore((state) => state.setExtrudeRetargetId);
  const setExtrudeSelectMode = useStore((state) => state.setExtrudeSelectMode);
  const extrudeSelectMode = useStore((state) => state.extrudeSelectMode);
  const extrudeRetargetId = useStore((state) => state.extrudeRetargetId);
  const setExtrudeEditTarget = useStore((state) => state.setExtrudeEditTarget);
  const setChamferEditTarget = useStore((state) => state.setChamferEditTarget);
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
      <div className="timeline-header">Timeline</div>
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

          return (
            <div
              key={entry.id}
              className={[
                "timeline-entry",
                isActive ? "active" : "",
                isFuture ? "future" : "",
                entry._orphaned ? "orphaned" : "",
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
                  {entryIcon(entry.label)}
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
              {entry.instruction?.type === "create" &&
                entry.instruction.item?.type === "extrude" && (
                  <>
                    <button
                      className={`timeline-action-btn${
                        extrudeSelectMode === "profile" &&
                        extrudeRetargetId === entry.instruction.item.id
                          ? " active"
                          : ""
                      }`}
                      title="Retarget Profile — pick a new face or sketch region to extrude from"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExtrudeRetargetId(entry.instruction.item.id);
                        setExtrudeSelectMode("profile");
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
                      title="Edit extrusion length"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExtrudeEditTarget({
                          itemId: entry.instruction.item.id,
                        });
                      }}
                    >
                      <svg viewBox="0 0 24 24" width="14" height="14">
                        <line
                          x1="4"
                          y1="12"
                          x2="20"
                          y2="12"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <line
                          x1="4"
                          y1="8"
                          x2="4"
                          y2="16"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <line
                          x1="20"
                          y1="8"
                          x2="20"
                          y2="16"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                        <polyline
                          points="9,9 12,12 9,15"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <polyline
                          points="15,9 12,12 15,15"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                  </>
                )}
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
