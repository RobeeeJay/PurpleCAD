import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { exportSTL, exportSTEP, importStep } from "../../three/occClient.js";
import { maxItemId } from "../../store/internals.js";
import { getSolid } from "../../three/solidCache.js";
import { activePrecision } from "../../three/resolution.js";
import {
  parseStl,
  parseSvgToSketchShapes,
  finalizeImportedMesh,
} from "../../three/importGeometry.js";

const DocumentSection = () => {
  const history = useStore((s) => s.history);
  const activeHistoryId = useStore((s) => s.activeHistoryId);
  const setProjectsDialogOpen = useStore((s) => s.setProjectsDialogOpen);
  const loadDocument = useStore((s) => s.loadDocument);
  const createProject = useStore((s) => s.createProject);
  const items = useStore((s) => s.items);
  const curveResolution = useStore((s) => s.curveResolution);
  const variables = useStore((s) => s.variables);
  const setVariablesDialogOpen = useStore((s) => s.setVariablesDialogOpen);
  const cameraControls = useStore((s) => s._cameraControls);
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const addItem = useStore((s) => s.addItem);
  const setSvgImport = useStore((s) => s.setSvgImport);
  const selectItem = useStore((s) => s.selectItem);

  const selectedItem = items.find((i) => i.id === selectedId);
  const isSketch = selectedItem?.type === "sketch";

  const importInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const saveBtnRef = useRef(null);
  const saveMenuRef = useRef(null);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [saveMenuPos, setSaveMenuPos] = useState(null);
  const importBtnRef = useRef(null);
  const importMenuRef = useRef(null);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [importMenuPos, setImportMenuPos] = useState(null);

  // Position a dropdown under its trigger and close it on outside-click / Esc.
  const useDropdown = (open, setOpen, btnRef, menuRef, setPos) => {
    useEffect(() => {
      if (!open) return;
      const rect = btnRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 4, left: rect.left });
      const onPointerDown = (e) => {
        if (
          !menuRef.current?.contains(e.target) &&
          !btnRef.current?.contains(e.target)
        )
          setOpen(false);
      };
      const onKeyDown = (e) => {
        if (e.key === "Escape") setOpen(false);
      };
      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("keydown", onKeyDown);
      return () => {
        document.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("keydown", onKeyDown);
      };
    }, [open, setOpen, btnRef, menuRef, setPos]);
  };
  useDropdown(
    saveMenuOpen,
    setSaveMenuOpen,
    saveBtnRef,
    saveMenuRef,
    setSaveMenuPos,
  );
  useDropdown(
    importMenuOpen,
    setImportMenuOpen,
    importBtnRef,
    importMenuRef,
    setImportMenuPos,
  );

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
    a.download = "scene.pcad";
    a.click();
    URL.revokeObjectURL(url);
    setSaveMenuOpen(false);
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

  // Exports tessellate at the ACTIVE resolution; in preview mode that's the
  // coarse mesh, which pits/facets a printed part.  Warn before exporting so
  // the user can switch on high-res print mode first.  Returns false to abort.
  const confirmExportResolution = (kind) => {
    if (curveResolution === "print") return true;
    return window.confirm(
      `High-resolution print mode is OFF, so this ${kind} will export at the ` +
        `coarser preview tessellation (curved surfaces will look faceted).\n\n` +
        `Turn on print mode (the resolution toggle) for a smooth mesh, then ` +
        `export again.\n\nExport at preview resolution anyway?`,
    );
  };

  // Export the selected objects (single or multi) in their current cached
  // timeline state, or the whole scene when nothing is selected.
  const exportItems = () => {
    const ids = new Set(
      selectedIds?.length
        ? selectedIds
        : selectedId != null
          ? [selectedId]
          : [],
    );
    return ids.size ? items.filter((i) => ids.has(i.id)) : items;
  };

  // Export payload: the chosen items, plus the ACTIVE tessellation precision and
  // each item's CURRENT cached solid id (so the export is the exact on-screen
  // geometry at the selected resolution, not a fixed-coarse rebuild).  Uncached
  // items fall back to a recipe rebuild at the same precision inside the op.
  const exportPayload = (expItems) => {
    const precision = activePrecision(useStore.getState());
    const cachedShapeIds = {};
    for (const it of expItems) {
      const s = getSolid(it.id, precision);
      if (s != null) cachedShapeIds[it.id] = s;
    }
    return { items: expItems, allItems: items, precision, cachedShapeIds };
  };

  const handleExportSTL = async () => {
    setSaveMenuOpen(false);
    if (items.length === 0) {
      alert("No objects to export.");
      return;
    }
    if (!confirmExportResolution("STL")) return;
    try {
      const buffer = await exportSTL(exportPayload(exportItems()));
      if (!buffer) {
        alert("No exportable objects in the scene.");
        return;
      }
      download(
        new Blob([buffer], { type: "application/octet-stream" }),
        "scene.stl",
      );
    } catch (err) {
      console.error("STL export failed:", err);
      alert("STL export failed: " + err.message);
    }
  };

  const handleExportSTEP = async () => {
    setSaveMenuOpen(false);
    if (items.length === 0) {
      alert("No objects to export.");
      return;
    }
    if (!confirmExportResolution("STEP")) return;
    try {
      const content = await exportSTEP(exportPayload(exportItems()));
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

  const handleSaveImage = async () => {
    setSaveMenuOpen(false);
    const blob = await cameraControls?.captureScreenshot?.();
    if (!blob) {
      alert("Couldn't capture the viewport.");
      return;
    }
    download(blob, "scene.png");
  };

  // Import — open the file picker restricted to the chosen kind.
  const handleImportKind = (accept) => {
    setImportMenuOpen(false);
    if (!importInputRef.current) return;
    importInputRef.current.accept = accept;
    importInputRef.current.value = "";
    importInputRef.current.click();
  };

  // Load a .pcad document (JSON; legacy .cad.json still accepted) as a NEW
  // project (existing projects untouched), then load its data into it.
  const handleLoadClick = () => {
    setImportMenuOpen(false);
    fileInputRef.current.value = "";
    fileInputRef.current.click();
  };
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const baseName = file.name.replace(/\.(pcad|cad\.json|json)$/i, "");
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.history || !Array.isArray(data.history)) {
          alert("Invalid document file.");
          return;
        }
        await createProject(baseName || "Imported");
        loadDocument(data);
      } catch (err) {
        alert("Failed to read document: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  const addImportedSolid = (geometryData, name) => {
    const id = maxItemId(history) + 1;
    addItem({
      id,
      name,
      type: "csg",
      children: [],
      geometryData,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
    selectItem(id);
  };

  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.toLowerCase().split(".").pop();
    const baseName = file.name.replace(/\.[^.]+$/, "");
    try {
      if (isSketch) {
        if (ext !== "svg") {
          alert("In a sketch, import SVG geometry.");
          return;
        }
        const shapes = parseSvgToSketchShapes(await file.text());
        if (shapes.length === 0) {
          alert("No importable geometry found in the SVG.");
          return;
        }
        // Don't commit yet — let the user scale/move it first.
        setSvgImport({
          sketchId: selectedId,
          shapes,
          scale: 1,
          offsetX: 0,
          offsetY: 0,
        });
        requestAnimationFrame(() =>
          useStore.getState()._cameraControls?.updateSvgPreview?.(),
        );
      } else if (ext === "stl") {
        addImportedSolid(
          parseStl(await file.arrayBuffer()).geometryData,
          `${baseName} (STL)`,
        );
      } else if (ext === "step" || ext === "stp") {
        const res = await importStep({ stepText: await file.text() });
        addImportedSolid(
          finalizeImportedMesh(res.positions, res.indices).geometryData,
          `${baseName} (STEP)`,
        );
      } else {
        alert("Import STL or STEP files in the 3D view, or SVG in a sketch.");
      }
    } catch (err) {
      console.error("Import failed:", err);
      alert("Import failed: " + err.message);
    }
  };

  return (
    <ToolbarSection label="Document">
      <button
        className="toolbar-btn"
        title="Projects — manage and switch between projects"
        onClick={() => setProjectsDialogOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinejoin="miter"
            x="3"
            y="4"
            width="8"
            height="7"
          />
          <rect
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinejoin="miter"
            x="13"
            y="4"
            width="8"
            height="7"
          />
          <rect
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeLinejoin="miter"
            x="3"
            y="13"
            width="8"
            height="7"
          />
          <rect
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinejoin="miter"
            x="13"
            y="13"
            width="8"
            height="7"
          />
        </svg>
      </button>
      <button
        ref={saveBtnRef}
        className="toolbar-btn"
        title="Save / Export"
        onClick={() => setSaveMenuOpen((open) => !open)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            d="M4 14 L4 20 L20 20 L20 14"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="12"
            y1="16"
            x2="12"
            y2="4"
          />
          <polyline
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            points="7,9 12,4 17,9"
          />
        </svg>
      </button>
      {saveMenuOpen &&
        saveMenuPos &&
        createPortal(
          <div
            className="toolbar-dropdown-menu"
            ref={saveMenuRef}
            style={{ top: saveMenuPos.top, left: saveMenuPos.left }}
          >
            <button className="toolbar-dropdown-item" onClick={handleSave}>
              Save document (.pcad)
            </button>
            <button className="toolbar-dropdown-item" onClick={handleExportSTL}>
              Export as STL
            </button>
            <button
              className="toolbar-dropdown-item"
              onClick={handleExportSTEP}
            >
              Export as STEP
            </button>
            <button className="toolbar-dropdown-item" onClick={handleSaveImage}>
              Save image (.png)
            </button>
          </div>,
          document.body,
        )}
      <button
        ref={importBtnRef}
        className="toolbar-btn"
        title="Load / Import"
        onClick={() => setImportMenuOpen((open) => !open)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            d="M4 14 L4 20 L20 20 L20 14"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="12"
            y1="3"
            x2="12"
            y2="15"
          />
          <polyline
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            points="7,10 12,15 17,10"
          />
        </svg>
      </button>
      {importMenuOpen &&
        importMenuPos &&
        createPortal(
          <div
            className="toolbar-dropdown-menu"
            ref={importMenuRef}
            style={{ top: importMenuPos.top, left: importMenuPos.left }}
          >
            <button className="toolbar-dropdown-item" onClick={handleLoadClick}>
              Load document (.pcad)
            </button>
            <button
              className="toolbar-dropdown-item"
              onClick={() => handleImportKind(".stl")}
            >
              Import STL
            </button>
            <button
              className="toolbar-dropdown-item"
              onClick={() => handleImportKind(".step,.stp")}
            >
              Import STEP
            </button>
            <button className="toolbar-dropdown-item" disabled>
              Import image (.png)
            </button>
          </div>,
          document.body,
        )}
      <button
        className="toolbar-btn"
        title="Variables"
        onClick={() => setVariablesDialogOpen(true)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            x="2"
            y="3"
            width="20"
            height="18"
          />
          <text
            x="5"
            y="16"
            fontSize="13"
            fontStyle="italic"
            fontFamily="Georgia, serif"
            fontWeight="700"
            fill="#6C3FD4"
          >
            f
          </text>
          <text
            x="12"
            y="16"
            fontSize="11"
            fontStyle="italic"
            fontFamily="Georgia, serif"
            fill="#D4A33F"
          >
            x
          </text>
        </svg>
      </button>
      <input
        ref={importInputRef}
        type="file"
        style={{ display: "none" }}
        onChange={handleImportFile}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept=".pcad,.cad.json,.json"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />
    </ToolbarSection>
  );
};

export default DocumentSection;
