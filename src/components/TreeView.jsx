import React, { useState, useRef, useEffect } from "react";
import { useStore } from "../store";
import { getDescendantFolderIds, nextFolderId } from "../store/folderSlice.js";
import "../styles/TreeView.css";

const SketchObjectIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24">
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="0.75"
      strokeDasharray="1.5 2"
      x1="2"
      y1="8"
      x2="22"
      y2="8"
    />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="0.75"
      strokeDasharray="1.5 2"
      x1="2"
      y1="14"
      x2="22"
      y2="14"
    />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="0.75"
      strokeDasharray="1.5 2"
      x1="8"
      y1="2"
      x2="8"
      y2="22"
    />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="0.75"
      strokeDasharray="1.5 2"
      x1="14"
      y1="2"
      x2="14"
      y2="22"
    />
    <polygon
      stroke="#6C3FD4"
      fill="none"
      strokeWidth="1.5"
      strokeLinejoin="miter"
      points="6,17 5,11 10,5 17,6 19,13 14,19"
    />
    <circle fill="#D4A33F" stroke="#D4A33F" r="1.3" cx="6" cy="17" />
    <circle fill="#D4A33F" stroke="#D4A33F" r="1.3" cx="5" cy="11" />
    <circle fill="#D4A33F" stroke="#D4A33F" r="1.3" cx="10" cy="5" />
    <circle fill="#D4A33F" stroke="#D4A33F" r="1.3" cx="17" cy="6" />
    <circle fill="#D4A33F" stroke="#D4A33F" r="1.3" cx="19" cy="13" />
    <circle fill="#D4A33F" stroke="#D4A33F" r="1.3" cx="14" cy="19" />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1.25"
      strokeLinecap="square"
      x1="19"
      y1="4"
      x2="21"
      y2="6"
    />
    <polygon
      fill="#6C3FD4"
      stroke="#6C3FD4"
      strokeWidth="0.5"
      points="21,6 19.5,7.5 22,7.5"
    />
  </svg>
);

const ThreeDObjectIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24">
    <polygon
      stroke="#6C3FD4"
      fill="rgba(108,63,212,0.55)"
      strokeWidth="1.5"
      strokeLinejoin="miter"
      points="2,8 16,8 16,22 2,22"
    />
    <polygon
      stroke="#6C3FD4"
      fill="rgba(108,63,212,0.22)"
      strokeWidth="1.5"
      strokeLinejoin="miter"
      points="2,8 6,4 20,4 16,8"
    />
    <polygon
      stroke="#6C3FD4"
      fill="rgba(108,63,212,0.38)"
      strokeWidth="1.5"
      strokeLinejoin="miter"
      points="16,8 20,4 20,18 16,22"
    />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1"
      strokeDasharray="2 1.5"
      x1="6"
      y1="4"
      x2="6"
      y2="18"
    />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1"
      strokeDasharray="2 1.5"
      x1="6"
      y1="18"
      x2="16"
      y2="18"
    />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1"
      strokeDasharray="2 1.5"
      x1="6"
      y1="18"
      x2="2"
      y2="22"
    />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1.25"
      strokeLinecap="square"
      x1="9"
      y1="15"
      x2="9"
      y2="11"
    />
    <polygon
      fill="#D4A33F"
      stroke="#D4A33F"
      strokeWidth="0.5"
      points="9,11 7.5,13.5 10.5,13.5"
    />
  </svg>
);

const FolderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24">
    <rect
      stroke="#c4c2b8"
      fill="none"
      strokeWidth="1.5"
      strokeLinejoin="miter"
      x="2"
      y="8"
      width="20"
      height="13"
    />
    <polyline
      stroke="#c4c2b8"
      fill="none"
      strokeWidth="1.5"
      strokeLinejoin="miter"
      points="2,8 2,5 8,5 10,8"
    />
    <line
      stroke="#6C3FD4"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="2"
      y1="11"
      x2="22"
      y2="11"
    />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1"
      strokeLinecap="square"
      x1="6"
      y1="15"
      x2="18"
      y2="15"
    />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1"
      strokeLinecap="square"
      x1="6"
      y1="18"
      x2="14"
      y2="18"
    />
  </svg>
);

const NewFolderIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24">
    <rect
      stroke="#c4c2b8"
      fill="none"
      strokeWidth="1.5"
      strokeLinejoin="miter"
      x="2"
      y="8"
      width="20"
      height="13"
    />
    <polyline
      stroke="#c4c2b8"
      fill="none"
      strokeWidth="1.5"
      strokeLinejoin="miter"
      points="2,8 2,5 8,5 10,8"
    />
    <line
      stroke="#6C3FD4"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="2"
      y1="11"
      x2="22"
      y2="11"
    />
    <line
      stroke="#6C3FD4"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="12"
      y1="14"
      x2="12"
      y2="20"
    />
    <line
      stroke="#6C3FD4"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="9"
      y1="17"
      x2="15"
      y2="17"
    />
  </svg>
);

const VisibleIcon = () => (
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
);

const HiddenIcon = () => (
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
);

// Merges items (geometry, parentId may point at another item or a folder)
// and folders (organizational only, parentId may point at another folder)
// into one tree. Folder ids are "folder-N" strings so they never collide
// with numeric item ids.
const buildTree = (items, folders) => {
  const byId = {};
  folders.forEach((f) => {
    byId[f.id] = Object.assign({}, f, { _kind: "folder", _children: [] });
  });
  items.forEach((i) => {
    byId[i.id] = Object.assign({}, i, { _kind: "item", _children: [] });
  });
  const roots = [];
  folders.forEach((f) => {
    const node = byId[f.id];
    if (f.parentId != null && byId[f.parentId]) {
      byId[f.parentId]._children.push(node);
    } else {
      roots.push(node);
    }
  });
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
  editingFolderId,
  onConsumeEditingFolder,
}) => {
  const selectItem = useStore((s) => s.selectItem);
  const addToSelection = useStore((s) => s.addToSelection);
  const setHoveredId = useStore((s) => s.setHoveredId);
  const toggleItemExpanded = useStore((s) => s.toggleItemExpanded);
  const toggleItemVisibility = useStore((s) => s.toggleItemVisibility);
  const deleteItem = useStore((s) => s.deleteItem);
  const renameItem = useStore((s) => s.renameItem);
  const toggleFolderExpanded = useStore((s) => s.toggleFolderExpanded);
  const renameFolder = useStore((s) => s.renameFolder);
  const deleteFolder = useStore((s) => s.deleteFolder);
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const hoveredId = useStore((s) => s.hoveredId);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  const isFolder = node._kind === "folder";
  const hasChildren = node._children && node._children.length > 0;
  const isSketch = node.type === "sketch";
  const dragEnabled = isFolder || !isSketch;
  const isDragging = dragState.draggingId === node.id;
  const isDropTarget = dragState.dropTargetId === node.id;
  const isSecondarySelected =
    !isFolder && selectedId !== node.id && selectedIds.includes(node.id);
  const isHidden = !isFolder && node.visible === false;

  const getIcon = (type) =>
    type === "sketch" ? <SketchObjectIcon /> : <ThreeDObjectIcon />;

  const startRename = (e) => {
    e.stopPropagation();
    setDraft(node.name);
    setEditing(true);
  };

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== node.name) {
      if (isFolder) renameFolder(node.id, trimmed);
      else renameItem(node.id, draft);
    }
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

  useEffect(() => {
    if (isFolder && editingFolderId === node.id) {
      setDraft(node.name);
      setEditing(true);
      onConsumeEditingFolder();
    }
  }, [editingFolderId]);

  return (
    <div className="tree-item-wrapper">
      <div
        className={[
          "tree-item",
          isFolder ? "folder-item" : "",
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
        draggable={dragEnabled && !editing}
        onDragStart={
          dragEnabled ? (e) => onDragStart(e, node.id, node._kind) : undefined
        }
        onDragOver={
          dragEnabled ? (e) => onDragOver(e, node.id, node._kind) : undefined
        }
        onDragLeave={dragEnabled ? (e) => onDragLeave(e) : undefined}
        onDrop={dragEnabled ? (e) => onDrop(e, node.id, node._kind) : undefined}
        onMouseEnter={() => setHoveredId(node.id)}
        onMouseLeave={() => setHoveredId(null)}
      >
        {hasChildren ? (
          <button
            className="expand-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (isFolder) toggleFolderExpanded(node.id);
              else toggleItemExpanded(node.id);
            }}
          >
            {node.expanded ? "▼" : "▶"}
          </button>
        ) : (
          <span className="expand-spacer" />
        )}

        <span className="tree-icon">
          {isFolder ? <FolderIcon /> : getIcon(node.type)}
        </span>

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
            onClick={
              isFolder
                ? undefined
                : (e) =>
                    e.shiftKey ? addToSelection(node.id) : selectItem(node.id)
            }
          >
            {node.name}
          </span>
        )}

        {!editing && (
          <>
            {!isFolder && (
              <button
                className={`tree-action-btn visibility-btn ${isHidden ? "always-visible" : ""}`}
                title={isHidden ? "Show" : "Hide"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleItemVisibility(node.id);
                }}
              >
                {isHidden ? <HiddenIcon /> : <VisibleIcon />}
              </button>
            )}
            <button
              className="tree-action-btn rename-btn"
              title="Rename"
              onClick={startRename}
            >
              ✎
            </button>
            <button
              className="tree-action-btn delete-btn"
              title={isFolder ? "Delete folder" : "Delete"}
              onClick={() =>
                isFolder ? deleteFolder(node.id) : deleteItem(node.id)
              }
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
              key={`${child._kind}-${child.id}`}
              node={child}
              depth={depth + 1}
              items={items}
              dragState={dragState}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
              editingFolderId={editingFolderId}
              onConsumeEditingFolder={onConsumeEditingFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const TreeView = ({ items }) => {
  const folders = useStore((s) => s.folders);
  const reparentItem = useStore((s) => s.reparentItem);
  const reparentFolder = useStore((s) => s.reparentFolder);
  const addFolder = useStore((s) => s.addFolder);
  const hideHiddenItems = useStore((s) => s.hideHiddenItems);
  const toggleHideHiddenItems = useStore((s) => s.toggleHideHiddenItems);
  const [dragState, setDragState] = useState({
    draggingId: null,
    draggingKind: null,
    dropTargetId: null,
  });
  const [editingFolderId, setEditingFolderId] = useState(null);

  let visibleItems = items;
  if (hideHiddenItems) {
    const excluded = new Set();
    items.forEach((i) => {
      if (i.visible === false) {
        excluded.add(i.id);
        getDescendantIds(i.id, items).forEach((id) => excluded.add(id));
      }
    });
    visibleItems = items.filter((i) => !excluded.has(i.id));
  }

  const roots = buildTree(visibleItems, folders);

  const handleAddFolder = () => {
    const id = nextFolderId(folders);
    addFolder(null);
    setEditingFolderId(id);
  };

  const handleDragStart = (e, id, kind) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify({ id, kind }));
    // Defer so the drag image captures the non-dragging state
    requestAnimationFrame(() =>
      setDragState((s) => ({ ...s, draggingId: id, draggingKind: kind })),
    );
  };

  const handleDragOver = (e, targetId, targetKind) => {
    const { draggingId, draggingKind } = dragState;
    if (!draggingId || draggingId === targetId) return;
    if (draggingKind === "folder") {
      if (targetKind !== "folder") return;
      if (getDescendantFolderIds(draggingId, folders).has(targetId)) return;
    } else {
      if (getDescendantIds(draggingId, items).has(targetId)) return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragState.dropTargetId !== targetId) {
      setDragState((s) => ({ ...s, dropTargetId: targetId }));
    }
  };

  const handleDragLeave = () => {
    // Cleared lazily on dragOver of new target; just reset on container leave
  };

  const handleDrop = (e, targetId, targetKind) => {
    e.preventDefault();
    let data = null;
    try {
      data = JSON.parse(e.dataTransfer.getData("text/plain"));
    } catch {
      data = null;
    }
    if (data && data.id !== targetId) {
      if (data.kind === "folder") {
        if (
          targetKind === "folder" &&
          !getDescendantFolderIds(data.id, folders).has(targetId)
        ) {
          reparentFolder(data.id, targetId);
        }
      } else if (!getDescendantIds(data.id, items).has(targetId)) {
        reparentItem(data.id, targetId);
      }
    }
    setDragState({ draggingId: null, draggingKind: null, dropTargetId: null });
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
    let data = null;
    try {
      data = JSON.parse(e.dataTransfer.getData("text/plain"));
    } catch {
      data = null;
    }
    if (data) {
      if (data.kind === "folder") reparentFolder(data.id, null);
      else reparentItem(data.id, null);
    }
    setDragState({ draggingId: null, draggingKind: null, dropTargetId: null });
  };

  const handleDragEnd = () => {
    setDragState({ draggingId: null, draggingKind: null, dropTargetId: null });
  };

  return (
    <div className="tree-view" onDragEnd={handleDragEnd}>
      <div className="tree-view-header">
        <span className="tree-view-title">Objects</span>
        <div className="tree-view-header-actions">
          <button
            className="tree-header-btn"
            title="New folder"
            onClick={handleAddFolder}
          >
            <NewFolderIcon />
          </button>
          <button
            className={`tree-header-btn ${hideHiddenItems ? "active" : ""}`}
            title={
              hideHiddenItems ? "Show hidden objects" : "Hide hidden objects"
            }
            onClick={toggleHideHiddenItems}
          >
            {hideHiddenItems ? <HiddenIcon /> : <VisibleIcon />}
          </button>
        </div>
      </div>
      <div className="tree-view-content">
        {roots.map((node) => (
          <TreeViewItem
            key={`${node._kind}-${node.id}`}
            node={node}
            depth={0}
            items={items}
            dragState={dragState}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            editingFolderId={editingFolderId}
            onConsumeEditingFolder={() => setEditingFolderId(null)}
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
