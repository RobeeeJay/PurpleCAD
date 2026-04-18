import React from 'react'
import { useStore } from '../store'
import '../styles/Toolbar.css'

const Toolbar = () => {
  const addItem = useStore((state) => state.addItem)
  const toggleTheme = useStore((state) => state.toggleTheme)
  const theme = useStore((state) => state.theme)
  const renderMode = useStore((state) => state.renderMode)
  const setRenderMode = useStore((state) => state.setRenderMode)
  let nextId = 3

  const createItem = (type, name) => {
    const newItem = {
      id: nextId++,
      name: name || `${type.charAt(0).toUpperCase() + type.slice(1)} ${nextId}`,
      type: type,
      children: []
    }
    addItem(newItem)
  }

  return (
    <div className="toolbar">
      {/* Create Section */}
      <div className="toolbar-section">
        <div className="toolbar-label">Create</div>
        <div className="toolbar-buttons">
          <button
            className="toolbar-btn"
            title="Sketch Plane"
            onClick={() => createItem('sketch', `Sketch ${nextId}`)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <rect x="3" y="3" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" />
              <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1" />
              <line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
          <button
            className="toolbar-btn"
            title="Cube"
            onClick={() => createItem('cube', `Cube ${nextId}`)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M3 5v12h18V5M3 5l9-4 9 4m0 12l-9 4-9-4" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
          <button
            className="toolbar-btn"
            title="Sphere"
            onClick={() => createItem('sphere', `Sphere ${nextId}`)}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
              <ellipse cx="12" cy="12" rx="3" ry="9" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Combine Section */}
      <div className="toolbar-section">
        <div className="toolbar-label">Combine</div>
        <div className="toolbar-buttons">
          <button className="toolbar-btn" title="Union">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <circle cx="8" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="16" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
          <button className="toolbar-btn" title="Difference">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <circle cx="8" cy="12" r="5" fill="currentColor" opacity="0.3" stroke="currentColor" strokeWidth="2" />
              <circle cx="16" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
          <button className="toolbar-btn" title="Intersection">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <circle cx="8" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
              <circle cx="16" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
              <path d="M 11 9 Q 13 12 11 15" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>

      {/* Constrain Section */}
      <div className="toolbar-section">
        <div className="toolbar-label">Constrain</div>
        <div className="toolbar-buttons">
          <button className="toolbar-btn" title="Horizontal">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="2" />
              <circle cx="4" cy="12" r="2" fill="currentColor" />
              <circle cx="20" cy="12" r="2" fill="currentColor" />
            </svg>
          </button>
          <button className="toolbar-btn" title="Vertical">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" strokeWidth="2" />
              <circle cx="12" cy="4" r="2" fill="currentColor" />
              <circle cx="12" cy="20" r="2" fill="currentColor" />
            </svg>
          </button>
          <button className="toolbar-btn" title="Perpendicular">
            <svg viewBox="0 0 24 24" width="20" height="20">
              <line x1="4" y1="12" x2="12" y2="12" stroke="currentColor" strokeWidth="2" />
              <line x1="12" y1="12" x2="12" y2="20" stroke="currentColor" strokeWidth="2" />
              <rect x="10" y="10" width="4" height="4" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Render Section */}
      <div className="toolbar-section">
        <div className="toolbar-label">Render</div>
        <div className="toolbar-buttons">
          <button
            className={`toolbar-btn ${renderMode === 'wireframe' ? 'active' : ''}`}
            title="Wireframe"
            onClick={() => setRenderMode('wireframe')}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M3 5v14h18V5m0 7h-18m9-7v14" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
          <button
            className={`toolbar-btn ${renderMode === 'shaded' ? 'active' : ''}`}
            title="Shaded"
            onClick={() => setRenderMode('shaded')}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M3 5v14h18V5z" fill="currentColor" opacity="0.3" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
          <button
            className={`toolbar-btn ${renderMode === 'smooth' ? 'active' : ''}`}
            title="Smooth"
            onClick={() => setRenderMode('smooth')}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="currentColor" />
                  <stop offset="100%" stopColor="currentColor" stopOpacity="0.3" />
                </linearGradient>
              </defs>
              <path d="M3 5v14h18V5z" fill="url(#grad)" stroke="currentColor" strokeWidth="2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Options Section */}
      <div className="toolbar-section">
        <div className="toolbar-label">Options</div>
        <div className="toolbar-buttons">
          <button
            className="toolbar-btn"
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            onClick={toggleTheme}
          >
            {theme === 'light' ? (
              <svg viewBox="0 0 24 24" width="20" height="20">
                <circle cx="12" cy="12" r="5" fill="currentColor" />
                <line x1="12" y1="1" x2="12" y2="3" stroke="currentColor" strokeWidth="2" />
                <line x1="12" y1="21" x2="12" y2="23" stroke="currentColor" strokeWidth="2" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" stroke="currentColor" strokeWidth="2" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" stroke="currentColor" strokeWidth="2" />
                <line x1="1" y1="12" x2="3" y2="12" stroke="currentColor" strokeWidth="2" />
                <line x1="21" y1="12" x2="23" y2="12" stroke="currentColor" strokeWidth="2" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" stroke="currentColor" strokeWidth="2" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" stroke="currentColor" strokeWidth="2" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" fill="currentColor" stroke="currentColor" strokeWidth="0" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export default Toolbar
