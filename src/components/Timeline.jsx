import React, { useState, useRef } from "react";
import { useStore } from "../store";
import "../styles/Timeline.css";

const entryIcon = (label) => {
  if (label.startsWith("Added")) return "+";
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
  }
  return `#${itemId}`;
};

const getDisplayLabel = (entry, history) => {
  if (entry.itemId != null) {
    return `${entry.label} ${getItemName(history, entry.itemId)}`;
  }
  return entry.label;
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
