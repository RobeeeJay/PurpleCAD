import React, { useRef } from "react";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { exportSTL, exportSTEP } from "../../three/occClient.js";

const DocumentSection = () => {
  const history = useStore((s) => s.history);
  const activeHistoryId = useStore((s) => s.activeHistoryId);
  const newDocument = useStore((s) => s.newDocument);
  const loadDocument = useStore((s) => s.loadDocument);
  const items = useStore((s) => s.items);
  const variables = useStore((s) => s.variables);
  const setVariablesDialogOpen = useStore((s) => s.setVariablesDialogOpen);

  const fileInputRef = useRef(null);

  const handleNew = () => {
    if (
      window.confirm(
        "Create a new document? All current objects and timeline history will be cleared.",
      )
    )
      newDocument();
  };

  const handleSave = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          { version: 1, history, activeHistoryId, variables },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scene.cad.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadClick = () => {
    fileInputRef.current.value = "";
    fileInputRef.current.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.history || !Array.isArray(data.history)) {
          alert("Invalid document file.");
          return;
        }
        if (
          window.confirm(
            "Load this document? All current objects and timeline history will be cleared.",
          )
        )
          loadDocument(data);
      } catch (err) {
        alert("Failed to read document: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  // Trigger a browser download for a Blob.
  const download = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportSTL = async () => {
    if (items.length === 0) {
      alert("No objects to export.");
      return;
    }
    try {
      const buffer = await exportSTL({ items });
      if (!buffer) {
        alert("No exportable objects in the scene.");
        return;
      }
      download(new Blob([buffer], { type: "application/octet-stream" }), "scene.stl");
    } catch (err) {
      console.error("STL export failed:", err);
      alert("STL export failed: " + err.message);
    }
  };

  const handleExportSTEP = async () => {
    if (items.length === 0) {
      alert("No objects to export.");
      return;
    }
    try {
      const content = await exportSTEP({ items });
      if (!content) {
        alert("No exportable objects in the scene.");
        return;
      }
      download(new Blob([content], { type: "application/step" }), "scene.step");
    } catch (err) {
      console.error("STEP export failed:", err);
      alert("STEP export failed: " + err.message);
    }
  };

  return (
    <ToolbarSection label="Document">
      <button className="toolbar-btn" title="New document" onClick={handleNew}>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M6 2h9l5 5v15H6V2z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <path
            d="M14 2v6h6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <line
            x1="9"
            y1="12"
            x2="15"
            y2="12"
            stroke="currentColor"
            strokeWidth="2"
          />
          <line
            x1="12"
            y1="9"
            x2="12"
            y2="15"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Save document"
        onClick={handleSave}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect
            x="3"
            y="3"
            width="18"
            height="18"
            rx="1"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <rect
            x="7"
            y="3"
            width="10"
            height="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <rect
            x="6"
            y="13"
            width="12"
            height="7"
            rx="1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Load document"
        onClick={handleLoadClick}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M3 7h5l2-3h6l2 3h3v13H3V7z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
          <polyline
            points="12,11 12,18"
            stroke="currentColor"
            strokeWidth="2"
          />
          <polyline
            points="9,15 12,18 15,15"
            stroke="currentColor"
            strokeWidth="2"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Export as STL"
        onClick={handleExportSTL}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M12 3v11m0 0l-4-4m4 4l4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3 17v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <text
            x="12"
            y="10"
            textAnchor="middle"
            fontSize="5.5"
            fontWeight="bold"
            fill="currentColor"
            fontFamily="monospace"
          >
            STL
          </text>
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Export as STEP"
        onClick={handleExportSTEP}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            d="M12 3v11m0 0l-4-4m4 4l4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M3 17v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <text
            x="12"
            y="10"
            textAnchor="middle"
            fontSize="5"
            fontWeight="bold"
            fill="currentColor"
            fontFamily="monospace"
          >
            STP
          </text>
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Variables"
        onClick={() => setVariablesDialogOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <text
            x="12"
            y="16"
            textAnchor="middle"
            fontSize="14"
            fontWeight="bold"
            fontStyle="italic"
            fill="currentColor"
            fontFamily="serif"
          >
            x
          </text>
          <line
            x1="5"
            y1="20"
            x2="19"
            y2="20"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.cad.json"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
    </ToolbarSection>
  );
};

export default DocumentSection;
