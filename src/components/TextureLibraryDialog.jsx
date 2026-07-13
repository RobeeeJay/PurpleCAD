import React, { useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store";
import {
  getDefaultLibrary,
  loadUserLibrary,
  saveUserLibrary,
  importSizeWarning,
} from "../three/textureLibrary.js";
import "../styles/ProjectsDialog.css";

// Bump-map library for the Texture tool: built-in procedural maps (animal
// scales / fabric / industrial) plus user imports.  Imports persist app-wide
// (settings table), can be renamed inline and deleted (with a warning);
// built-ins are fixed.  Clicking a card selects the image into the tool.
const TextureLibraryDialog = () => {
  const open = useStore((s) => s.textureLibraryOpen);
  const setOpen = useStore((s) => s.setTextureLibraryOpen);
  const updateTextureParams = useStore((s) => s.updateTextureParams);
  const [userLib, setUserLib] = useState(null); // lazy-loaded on open
  const [renamingId, setRenamingId] = useState(null);
  const [draftName, setDraftName] = useState("");
  const fileRef = useRef(null);

  const defaults = useMemo(() => (open ? getDefaultLibrary() : []), [open]);
  if (!open) return null;
  const user = userLib ?? loadUserLibrary();
  if (userLib == null) setUserLib(user);

  const close = () => {
    setRenamingId(null);
    setOpen(false);
  };

  const pick = (entry) => {
    updateTextureParams({ png: entry.dataURL, pngName: entry.name });
    close();
  };

  const persist = (list) => {
    setUserLib(list);
    saveUserLibrary(list);
  };

  const onImportFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataURL = reader.result;
      const img = new Image();
      img.onload = () => {
        const warning = importSizeWarning({
          width: img.naturalWidth,
          height: img.naturalHeight,
          bytes: file.size,
        });
        if (warning && !window.confirm(warning)) return;
        const id = `user-${Date.now()}`;
        const name = file.name.replace(/\.[^.]+$/, "");
        persist([...user, { id, name, dataURL }]);
        // Drop straight into rename so the import gets a proper name.
        setRenamingId(id);
        setDraftName(name);
      };
      img.onerror = () => window.alert("Could not read that image.");
      img.src = dataURL;
    };
    reader.readAsDataURL(file);
  };

  const commitRename = (id) => {
    const name = draftName.trim();
    if (name) persist(user.map((t) => (t.id === id ? { ...t, name } : t)));
    setRenamingId(null);
  };

  const remove = (entry) => {
    if (
      window.confirm(
        `Delete "${entry.name}" from the texture library? Existing texture ` +
          `steps keep their copy of the image; this cannot be undone.`,
      )
    )
      persist(user.filter((t) => t.id !== entry.id));
  };

  const card = (entry, editable) => (
    <div
      key={entry.id}
      className="project-card texture-card"
      onClick={() => pick(entry)}
      title={`Use "${entry.name}"`}
    >
      <div className="project-thumb texture-thumb">
        <img src={entry.dataURL} alt={entry.name} />
      </div>
      <div className="project-footer">
        {renamingId === entry.id ? (
          <input
            className="project-rename"
            autoFocus
            value={draftName}
            onFocus={(e) => e.target.select()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => commitRename(entry.id)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitRename(entry.id);
              if (e.key === "Escape") setRenamingId(null);
            }}
          />
        ) : (
          <div className="project-name">{entry.name}</div>
        )}
        {editable && (
          <div className="project-actions" style={{ opacity: 1 }}>
            <button
              className="project-icon-btn"
              title="Rename texture"
              onClick={(e) => {
                e.stopPropagation();
                setRenamingId(entry.id);
                setDraftName(entry.name);
              }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15">
                <path
                  d="M4 20 L4 16 L15 5 L19 9 L8 20 Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <line
                  x1="13"
                  y1="7"
                  x2="17"
                  y2="11"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
              </svg>
            </button>
            <button
              className="project-icon-btn project-danger"
              title="Delete texture"
              onClick={(e) => {
                e.stopPropagation();
                remove(entry);
              }}
            >
              <svg viewBox="0 0 24 24" width="15" height="15">
                <path
                  d="M6 7 L18 7 L17 20 L7 20 Z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <line
                  x1="4"
                  y1="7"
                  x2="20"
                  y2="7"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
                <path
                  d="M9 7 L9 4 L15 4 L15 7"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const categories = [...new Set(defaults.map((t) => t.category))];

  return createPortal(
    <div className="projects-backdrop" onPointerDown={close}>
      <div
        className="projects-dialog texture-library-dialog"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="projects-header">
          <h2>Texture library</h2>
          <div className="projects-header-actions">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              style={{ display: "none" }}
              onChange={onImportFile}
            />
            <button
              className="projects-new-btn"
              onClick={() => fileRef.current?.click()}
              title="Import an image into the library"
            >
              + Import image
            </button>
            <button className="projects-close" onClick={close} title="Close">
              ×
            </button>
          </div>
        </div>
        {categories.map((cat) => (
          <div key={cat}>
            <div className="texture-category-label">{cat}</div>
            <div className="projects-grid texture-grid">
              {defaults
                .filter((t) => t.category === cat)
                .map((t) => card(t, false))}
            </div>
          </div>
        ))}
        <div>
          <div className="texture-category-label">Imported</div>
          <div className="projects-grid texture-grid">
            {user.length === 0 && (
              <div className="texture-empty">
                No imported textures yet — use “Import image”.
              </div>
            )}
            {user.map((t) => card(t, true))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default TextureLibraryDialog;
