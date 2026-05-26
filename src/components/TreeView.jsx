import React, { useState, useRef, useEffect } from "react";
import { useStore } from "../store";
import "../styles/TreeView.css";

const buildTree = (items) => {
  const byId = {};
  items.forEach((i) => {
    byId[i.id] = Object.assign({}, i, { _children: [] });
  });
  const roots = [];
  items.forEach((i) => {
    const node = byId[i.id];
    if (i.parentId != null && byId[i.parentId]) {
      byId[i.parentId]._children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
};

const getDescendantIds = (itemId, items) => {
  const result = new Set();
  const queue = [itemId];
  while (queue.length > 0) {
    const pid = queue.shift();
    items.forEach((i) => {
      if (i.parentId === pid) {
        result.add(i.id);
        queue.push(i.id);
      }
    });
  }
  return result;
};

const TreeViewItem = ({
  node,
  depth,
  items,
  dragState,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}) => {
  const selectItem = useStore((s) => s.selectItem);
  const addToSelection = useStore((s) => s.addToSelection);
  const setHoveredId = useStore((s) => s.setHoveredId);
  const toggleItemExpanded = useStore((s) => s.toggleItemExpanded);
  const toggleItemVisibility = useStore((s) => s.toggleItemVisibility);
  const deleteItem = useStore((s) => s.deleteItem);
  const renameItem = useStore((s) => s.renameItem);
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const hoveredId = useStore((s) => s.hoveredId);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  const hasChildren = node._children && node._children.length > 0;
  const isSketch = node.type === "sketch";
  const isDragging = dragState.draggingId === node.id;
  const isDropTarget = dragState.dropTargetId === node.id;
  const isSecondarySelected =
    selectedId !== node.id && selectedIds.includes(node.id);
  const isHidden = node.visible === false;

  const getIcon = (type) => {
    switch (type) {
      case "sketch":
        return "📋";
      case "cube":
        return "📦";
      case "sphere":
        return "⚪";
      case "cylinder":
        return "🥫";
      case "torus":
        return "🍩";
      default:
        return "📄";
    }
  };

  const startRename = (e) => {
    e.stopPropagation();
    setDraft(node.name);
    setEditing(true);
  };

  const commitRename = () => {
    if (draft.trim() && draft.trim() !== node.name) renameItem(node.id, draft);
    setEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") commitRename();
    else if (e.key === "Escape") setEditing(false);
    e.stopPropagation();
  };

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  return (
    <div className="tree-item-wrapper">
      <div
        className={[
          "tree-item",
          selectedId === node.id ? "selected" : "",
          isSecondarySelected ? "secondary-selected" : "",
          hoveredId === node.id ? "hovered" : "",
          isDragging ? "dragging" : "",
          isDropTarget ? "drop-target" : "",
          isHidden ? "hidden-item" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        draggable={!isSketch && !editing}
        onDragStart={!isSketch ? (e) => onDragStart(e, node.id) : undefined}
        onDragOver={!isSketch ? (e) => onDragOver(e, node.id) : undefined}
        onDragLeave={!isSketch ? (e) => onDragLeave(e) : undefined}
        onDrop={!isSketch ? (e) => onDrop(e, node.id) : undefined}
        onMouseEnter={() => setHoveredId(node.id)}
        onMouseLeave={() => setHoveredId(null)}
      >
        {hasChildren ? (
          <button
            className="expand-btn"
            onClick={(e) => {
              e.stopPropagation();
              toggleItemExpanded(node.id);
            }}
          >
            {node.expanded ? "▼" : "▶"}
          </button>
        ) : (
          <span className="expand-spacer" />
        )}

        <span className="tree-icon">{getIcon(node.type)}</span>

        {editing ? (
          <input
            ref={inputRef}
            className="tree-rename-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="tree-label"
            onClick={(e) =>
              e.shiftKey ? addToSelection(node.id) : selectItem(node.id)
            }
          >
            {node.name}
          </span>
        )}

        {!editing && (
          <>
            <button
              className={`tree-action-btn visibility-btn ${isHidden ? "always-visible" : ""}`}
              title={isHidden ? "Show" : "Hide"}
              onClick={(e) => {
                e.stopPropagation();
                toggleItemVisibility(node.id);
              }}
            >
              {isHidden ? (
                <svg
                  viewBox="0 0 24 24"
                  width="12"
                  height="12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  width="12"
                  height="12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
            <button
              className="tree-action-btn rename-btn"
              title="Rename"
              onClick={startRename}
            >
              ✎
            </button>
            <button
              className="tree-action-btn delete-btn"
              title="Delete"
              onClick={() => deleteItem(node.id)}
            >
              ✕
            </button>
          </>
        )}
      </div>

      {hasChildren && node.expanded && (
        <div className="tree-children">
          {node._children.map((child) => (
            <TreeViewItem
              key={child.id}
              node={child}
              depth={depth + 1}
              items={items}
              dragState={dragState}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const TreeView = ({ items }) => {
  const reparentItem = useStore((s) => s.reparentItem);
  const selectedId = useStore((s) => s.selectedId);
  const [dragState, setDragState] = useState({
    draggingId: null,
    dropTargetId: null,
  });

  const roots = buildTree(items);

  const handleDragStart = (e, id) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(id));
    // Defer so the drag image captures the non-dragging state
    requestAnimationFrame(() =>
      setDragState((s) => ({ ...s, draggingId: id })),
    );
  };

  const handleDragOver = (e, targetId) => {
    e.preventDefault();
    const { draggingId } = dragState;
    if (!draggingId || draggingId === targetId) return;
    const descendantIds = getDescendantIds(draggingId, items);
    if (descendantIds.has(targetId)) return;
    e.dataTransfer.dropEffect = "move";
    if (dragState.dropTargetId !== targetId) {
      setDragState((s) => ({ ...s, dropTargetId: targetId }));
    }
  };

  const handleDragLeave = () => {
    // Cleared lazily on dragOver of new target; just reset on container leave
  };

  const handleDrop = (e, targetId) => {
    e.preventDefault();
    const draggingId = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (draggingId && draggingId !== targetId) {
      const descendantIds = getDescendantIds(draggingId, items);
      if (!descendantIds.has(targetId)) {
        reparentItem(draggingId, targetId);
      }
    }
    setDragState({ draggingId: null, dropTargetId: null });
  };

  const handleRootDragOver = (e) => {
    if (!dragState.draggingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragState.dropTargetId !== "root") {
      setDragState((s) => ({ ...s, dropTargetId: "root" }));
    }
  };

  const handleRootDrop = (e) => {
    e.preventDefault();
    const draggingId = parseInt(e.dataTransfer.getData("text/plain"), 10);
    if (draggingId) reparentItem(draggingId, null);
    setDragState({ draggingId: null, dropTargetId: null });
  };

  const handleDragEnd = () => {
    setDragState({ draggingId: null, dropTargetId: null });
  };

  return (
    <div className="tree-view" onDragEnd={handleDragEnd}>
      <div className="tree-view-header">Objects</div>
      <div className="tree-view-content">
        {roots.map((node) => (
          <TreeViewItem
            key={node.id}
            node={node}
            depth={0}
            items={items}
            dragState={dragState}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          />
        ))}
        <div
          className={`tree-root-drop-zone ${dragState.draggingId !== null && dragState.dropTargetId === "root" ? "active" : ""}`}
          onDragOver={handleRootDragOver}
          onDragLeave={() =>
            setDragState((s) =>
              s.dropTargetId === "root" ? { ...s, dropTargetId: null } : s,
            )
          }
          onDrop={handleRootDrop}
        />
      </div>
    </div>
  );
};

export default TreeView;
