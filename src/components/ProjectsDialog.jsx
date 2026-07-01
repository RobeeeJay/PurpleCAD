import React, { useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../store";
import "../styles/ProjectsDialog.css";

// Projects manager: a grid of project cards (viewport thumbnail + name + active
// badge).  Click a card to switch, "New project" to create, rename inline,
// delete (never the last one).  All backed by the per-project DB tables.
const ProjectsDialog = () => {
  const open = useStore((s) => s.projectsDialogOpen);
  const setOpen = useStore((s) => s.setProjectsDialogOpen);
  const projects = useStore((s) => s.projects);
  const activeProjectId = useStore((s) => s.activeProjectId);
  const switchProject = useStore((s) => s.switchProject);
  const createProject = useStore((s) => s.createProject);
  const renameProject = useStore((s) => s.renameProject);
  const deleteProject = useStore((s) => s.deleteProject);

  const [renamingId, setRenamingId] = useState(null);
  const [draftName, setDraftName] = useState("");

  if (!open) return null;

  const close = () => setOpen(false);

  const pick = async (id) => {
    if (id !== activeProjectId) await switchProject(id);
    close();
  };

  const create = async () => {
    const name = window.prompt("Name for the new project:", "Untitled");
    if (name == null) return; // cancelled
    await createProject(name.trim() || "Untitled");
    close();
  };

  const commitRename = (id) => {
    const name = draftName.trim();
    if (name) renameProject(id, name);
    setRenamingId(null);
  };

  return createPortal(
    <div className="projects-backdrop" onPointerDown={close}>
      <div
        className="projects-dialog"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="projects-header">
          <h2>Projects</h2>
          <button className="projects-close" onClick={close} title="Close">
            ×
          </button>
        </div>
        <div className="projects-grid">
          <button className="project-card project-new" onClick={create}>
            <div className="project-new-plus">+</div>
            <div className="project-name">New project</div>
          </button>
          {projects.map((p) => (
            <div
              key={p.id}
              className={`project-card${p.id === activeProjectId ? " active" : ""}`}
              onClick={() => pick(p.id)}
            >
              <div className="project-thumb">
                {p.thumbnail ? (
                  <img src={p.thumbnail} alt="" />
                ) : (
                  <div className="project-thumb-empty" />
                )}
                {p.id === activeProjectId && (
                  <span className="project-badge">Active</span>
                )}
              </div>
              <div className="project-footer">
                {renamingId === p.id ? (
                  <input
                    className="project-rename"
                    autoFocus
                    value={draftName}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={() => commitRename(p.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename(p.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                ) : (
                  <div
                    className="project-name"
                    title="Double-click to rename"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(p.id);
                      setDraftName(p.name);
                    }}
                  >
                    {p.name}
                  </div>
                )}
                <div className="project-actions">
                  <button
                    className="project-icon-btn"
                    title="Rename project"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(p.id);
                      setDraftName(p.name);
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
                  {projects.length > 1 && (
                    <button
                      className="project-icon-btn project-danger"
                      title="Delete project"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (
                          window.confirm(
                            `Delete project "${p.name}"? This cannot be undone.`,
                          )
                        )
                          deleteProject(p.id);
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
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ProjectsDialog;
