import { useState, useRef, useEffect } from "react";
import { useStore } from "../store";
import { getDescendantFolderIds, nextFolderId } from "../store/folderSlice.js";
import { ComponentIcon, NewComponentIcon } from "./icons/componentIcons.jsx";
import ComponentMotionButtons from "./ComponentMotionButtons.jsx";
import "../styles/TreeView.css";
import SvgIcon from "./icons/SvgIcon.jsx";

const SketchObjectIcon = () => <SvgIcon name="tree-sketch" size={16} />;

const ThreeDObjectIcon = () => <SvgIcon name="tree-body" size={16} />;

// A reference Plane: a translucent blue parallelogram with a dashed normal,
// matching the Plane toolbar button.
const PlaneObjectIcon = () => <SvgIcon name="tree-plane" size={16} />;

// Solo: a single filled dot inside a ring — "show only this".
const SoloIcon = () => <SvgIcon name="tree-solo" size={14} />;

const InspectorIcon = () => <SvgIcon name="tree-inspector" size={16} />;

const VisibleIcon = () => <SvgIcon name="visible" size={12} />;

const HiddenIcon = () => <SvgIcon name="hidden" size={12} />;

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
  const soloItemId = useStore((s) => s.soloItemId);
  const setItemSolo = useStore((s) => s.setItemSolo);
  const switchItemSolo = useStore((s) => s.switchItemSolo);
  const clearItemSolo = useStore((s) => s.clearItemSolo);

  const isSoloed = node._kind !== "folder" && soloItemId === node.id;

  // Toggle solo: first solo snapshots the camera; ending it restores that view;
  // switching to another item keeps the original snapshot.
  const toggleSolo = (e) => {
    e.stopPropagation();
    const state = useStore.getState();
    const cc = state._cameraControls;
    if (state.soloItemId === node.id) {
      if (state.soloView) cc?.restoreView?.(state.soloView);
      clearItemSolo();
    } else if (state.soloItemId == null) {
      // First solo: remember where we are, then frame the soloed object.
      setItemSolo(node.id, cc?.snapshotView?.() ?? null);
      cc?.frameObject?.(node.id);
    } else {
      // Switching solo: keep the original snapshot, frame the new object.
      switchItemSolo(node.id);
      cc?.frameObject?.(node.id);
    }
  };

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef(null);

  const isFolder = node._kind === "folder";
  const hasChildren = node._children && node._children.length > 0;
  // Everything is draggable — sketches included, so they can be organised into
  // folders (parentId is purely organizational, separate from a sketch's host).
  const dragEnabled = true;
  const isDragging = dragState.draggingId === node.id;
  const isDropTarget = dragState.dropTargetId === node.id;
  const isSecondarySelected =
    !isFolder && selectedId !== node.id && selectedIds.includes(node.id);
  const isHidden = !isFolder && node.visible === false;

  const getIcon = (type) => {
    if (type === "sketch") return <SketchObjectIcon />;
    if (type === "plane") return <PlaneObjectIcon />;
    return <ThreeDObjectIcon />;
  };

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
        style={{ paddingLeft: `${depth * 14 + 2}px` }}
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

        {isFolder ? (
          <span className="expand-spacer" />
        ) : (
          <button
            className={`tree-action-btn solo-btn ${isSoloed ? "always-visible active" : ""}`}
            title={isSoloed ? "Exit solo" : "Solo (show only this)"}
            onClick={toggleSolo}
          >
            <SoloIcon />
          </button>
        )}

        <span className="tree-icon">
          {isFolder ? <ComponentIcon /> : getIcon(node.type)}
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
            {isFolder && <ComponentMotionButtons folder={node} />}
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
              title={isFolder ? "Delete component (its parts stay)" : "Delete"}
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
  const setSceneInspectorOpen = useStore((s) => s.setSceneInspectorOpen);
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
            title="Scene inspector — detailed listing of every object (debug)"
            onClick={() => setSceneInspectorOpen(true)}
          >
            <InspectorIcon />
          </button>
          <button
            className="tree-header-btn"
            title="New component — a group of parts that can be given a motion"
            onClick={handleAddFolder}
          >
            <NewComponentIcon />
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
