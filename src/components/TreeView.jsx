import React from 'react'
import { useStore } from '../store'
import '../styles/TreeView.css'

const TreeViewItem = ({ item, depth = 0 }) => {
  const selectItem = useStore((state) => state.selectItem)
  const setHoveredId = useStore((state) => state.setHoveredId)
  const toggleItemExpanded = useStore((state) => state.toggleItemExpanded)
  const deleteItem = useStore((state) => state.deleteItem)
  const selectedId = useStore((state) => state.selectedId)
  const hoveredId = useStore((state) => state.hoveredId)

  const hasChildren = item.children && item.children.length > 0

  const getIcon = (type) => {
    switch (type) {
      case 'sketch':
        return '📋'
      case 'cube':
        return '📦'
      case 'sphere':
        return '⚪'
      default:
        return '📄'
    }
  }

  const isHovered = hoveredId === item.id

  return (
    <div className="tree-item-wrapper">
      <div
        className={`tree-item ${selectedId === item.id ? 'selected' : ''} ${isHovered ? 'hovered' : ''}`}
        style={{ paddingLeft: `${depth * 20}px` }}
        onMouseEnter={() => setHoveredId(item.id)}
        onMouseLeave={() => setHoveredId(null)}
      >
        {hasChildren && (
          <button
            className="expand-btn"
            onClick={() => toggleItemExpanded(item.id)}
          >
            {item.expanded ? '▼' : '▶'}
          </button>
        )}
        {!hasChildren && <span className="expand-spacer"></span>}
        
        <span className="tree-icon">{getIcon(item.type)}</span>
        <span
          className="tree-label"
          onClick={() => selectItem(item.id)}
        >
          {item.name}
        </span>
        
        <button
          className="delete-btn"
          onClick={() => deleteItem(item.id)}
          title="Delete"
        >
          ✕
        </button>
      </div>
      
      {item.expanded && hasChildren && (
        <div className="tree-children">
          {item.children.map((child) => (
            <TreeViewItem key={child.id} item={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

const TreeView = ({ items }) => {
  return (
    <div className="tree-view">
      <div className="tree-view-header">Objects</div>
      <div className="tree-view-content">
        {items.map((item) => (
          <TreeViewItem key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}

export default TreeView
