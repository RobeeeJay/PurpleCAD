import { weldForImport, openMeshWarning } from "../../three/importWeld.js";
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { exportSTL, exportSTEP, importStep } from "../../three/occClient.js";
import { packHistory } from "../../store/geometryPack.js";
import { maxItemId } from "../../store/internals.js";
import { activePrecision } from "../../three/resolution.js";
import {
  parseStl,
  parseSvgToSketchShapes,
  finalizeImportedMesh,
} from "../../three/importGeometry.js";
import { DEFAULT_UNDERLAY } from "../../three/sceneObjects/sketchUnderlay.js";
import SvgIcon from "../icons/SvgIcon.jsx";

const DocumentSection = () => {
  const history = useStore((s) => s.history);
  const activeHistoryId = useStore((s) => s.activeHistoryId);
  const setProjectsDialogOpen = useStore((s) => s.setProjectsDialogOpen);
  const loadDocument = useStore((s) => s.loadDocument);
  const createProject = useStore((s) => s.createProject);
  const items = useStore((s) => s.items);
  const variables = useStore((s) => s.variables);
  const folders = useStore((s) => s.folders);
  const setVariablesDialogOpen = useStore((s) => s.setVariablesDialogOpen);
  const cameraControls = useStore((s) => s._cameraControls);
  const selectedId = useStore((s) => s.selectedId);
  const selectedIds = useStore((s) => s.selectedIds);
  const addItem = useStore((s) => s.addItem);
  const setSvgImport = useStore((s) => s.setSvgImport);
  const setUnderlayImport = useStore((s) => s.setUnderlayImport);
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
    // Packed meshes (geometryPack.js): a dense displacement mesh as raw JSON
    // float text made documents 100s of MB and the stringify itself OOM'd.
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 1,
            history: packHistory(history),
            activeHistoryId,
            variables,
            // Components (tree folders) and their motions: not part of the
            // timeline, but a reopened file without them has lost its setup.
            folders,
          },
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

  // What an export takes: the whole scene, or only the selected objects
  // (single or multi) -- the menu offers both, rather than quietly exporting
  // the selection whenever there is one.
  const selectedItems = () => {
    const ids = new Set(
      selectedIds?.length
        ? selectedIds
        : selectedId != null
          ? [selectedId]
          : [],
    );
    return items.filter((i) => ids.has(i.id));
  };
  const nSelected = selectedItems().length;
  // The file is named for what it holds: "scene", one object's name, or
  // "selection" for several.
  const exportScope = (scope) => {
    if (scope === "scene") return { list: items, name: "scene" };
    const list = selectedItems();
    const name =
      list.length === 1
        ? (list[0].name || "selection").replace(/[\\/:*?"<>|]+/g, "_")
        : "selection";
    return { list, name };
  };

  // Export payload: the chosen items, the whole scene (so a selected body's
  // recipe still resolves its inputs), and the ACTIVE tessellation precision.
  // The op prefers each item's baked high-res mesh (exact on-screen geometry) and
  // only rebuilds the recipe at this precision for items with no baked mesh.
  const exportPayload = (expItems) => ({
    items: expItems,
    allItems: items,
    precision: activePrecision(useStore.getState()),
  });

  const nothingToExport = (scope) =>
    scope === "scene"
      ? "No exportable objects in the scene."
      : "Nothing in the selection can be exported -- select a solid body.";

  const handleExportSTL = async (scope) => {
    setSaveMenuOpen(false);
    const { list, name } = exportScope(scope);
    if (list.length === 0) {
      alert("No objects to export.");
      return;
    }
    try {
      const buffer = await exportSTL(exportPayload(list));
      if (!buffer) {
        alert(nothingToExport(scope));
        return;
      }
      download(
        new Blob([buffer], { type: "application/octet-stream" }),
        `${name}.stl`,
      );
    } catch (err) {
      console.error("STL export failed:", err);
      alert("STL export failed: " + err.message);
    }
  };

  const handleExportSTEP = async (scope) => {
    setSaveMenuOpen(false);
    const { list, name } = exportScope(scope);
    if (list.length === 0) {
      alert("No objects to export.");
      return;
    }
    try {
      const content = await exportSTEP(exportPayload(list));
      if (!content) {
        alert(nothingToExport(scope));
        return;
      }
      download(
        new Blob([content], { type: "application/step" }),
        `${name}.step`,
      );
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
  // A .pcad's text, opened as a new project.  The file input uses it, and so
  // does the iPad host when the Files app opens a .pcad in PurpleCAD (a
  // purplecad:open-document event, below).
  const openDocumentText = async (fileName, text) => {
    const baseName = fileName.replace(/\.(pcad|cad\.json|json)$/i, "");
    try {
      const data = JSON.parse(text);
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
  const openDocumentRef = useRef(openDocumentText);
  openDocumentRef.current = openDocumentText;
  useEffect(() => {
    const onOpen = (e) => openDocumentRef.current(e.detail.name, e.detail.text);
    window.addEventListener("purplecad:open-document", onOpen);
    return () => window.removeEventListener("purplecad:open-document", onOpen);
  }, []);
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => openDocumentText(file.name, ev.target.result);
    reader.readAsText(file);
  };

  // `regenerator`: an imported STEP body's recipe, its exact shape.
  const addImportedSolid = (geometryData, name, regenerator) => {
    const id = maxItemId(history) + 1;
    addItem({
      id,
      name,
      type: "csg",
      children: [],
      geometryData,
      ...(regenerator ? { regenerator } : null),
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
        // A raster image becomes a reference UNDERLAY to trace over (not
        // geometry); an SVG becomes real sketch shapes.
        if (["png", "jpg", "jpeg"].includes(ext)) {
          const dataUrl = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result);
            r.onerror = rej;
            r.readAsDataURL(file);
          });
          // Aspect up front so the plane is right-sized on the first frame.
          const imageAspect = await new Promise((res) => {
            const img = new Image();
            img.onload = () =>
              res(
                img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : 1,
              );
            img.onerror = () => res(1);
            img.src = dataUrl;
          });
          setUnderlayImport({
            ...DEFAULT_UNDERLAY,
            sketchId: selectedId,
            dataUrl,
            name: baseName,
            imageAspect,
          });
          return;
        }
        if (ext !== "svg") {
          alert(
            "In a sketch, import an SVG (geometry) or a PNG/JPEG (tracing underlay).",
          );
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
        const name = `${baseName} (STL)`;
        const { geometryData, report } = await weldForImport(
          parseStl(await file.arrayBuffer()).geometryData,
        );
        addImportedSolid(geometryData, name);
        const warning = openMeshWarning(name, report);
        if (warning) useStore.getState().showNotification(warning);
      } else if (ext === "step" || ext === "stp") {
        const res = await importStep({
          stepText: await file.text(),
          printPrecision: activePrecision(useStore.getState()),
        });
        const { geometryData } = finalizeImportedMesh(
          res.positions,
          res.indices,
        );
        // The shape keeps its exact surfaces as the body's recipe; the mesh
        // is its drawing, at the current Resolution.
        addImportedSolid(
          { ...geometryData, edges: res.edges },
          `${baseName} (STEP)`,
          res.brep
            ? {
                kind: "importedShape",
                brep: res.brep,
                regeneratedAt: activePrecision(useStore.getState()),
              }
            : null,
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
        <SvgIcon name="projects" size={20} />
      </button>
      <button
        ref={saveBtnRef}
        className="toolbar-btn"
        title="Save / Export"
        onClick={() => setSaveMenuOpen((open) => !open)}
      >
        <SvgIcon name="save" size={20} />
      </button>
      {saveMenuOpen &&
        saveMenuPos &&
        createPortal(
          <div
            className="toolbar-dropdown-menu"
            ref={saveMenuRef}
            style={{ top: saveMenuPos.top, left: saveMenuPos.left }}
          >
            <button
              className="toolbar-dropdown-item"
              title="Save the document as a portable .pcad file"
              onClick={handleSave}
            >
              Save document (.pcad)
            </button>
            {[
              ["STL", "a 3D-printable STL mesh", handleExportSTL],
              ["STEP", "a STEP file for other CAD tools", handleExportSTEP],
            ].map(([fmt, what, handler]) => (
              <Fragment key={fmt}>
                <button
                  className="toolbar-dropdown-item"
                  title={`Export every visible body as ${what}`}
                  onClick={() => handler("scene")}
                >
                  {`Export scene as ${fmt}`}
                </button>
                <button
                  className="toolbar-dropdown-item"
                  title={
                    nSelected
                      ? `Export only the selected ${nSelected === 1 ? "object" : `${nSelected} objects`} as ${what}`
                      : "Select the objects to export first"
                  }
                  disabled={nSelected === 0}
                  onClick={() => handler("selection")}
                >
                  {`Export selected as ${fmt}`}
                </button>
              </Fragment>
            ))}
            <button
              className="toolbar-dropdown-item"
              title="Save a PNG screenshot of the viewport"
              onClick={handleSaveImage}
            >
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
        <SvgIcon name="open" size={20} />
      </button>
      {importMenuOpen &&
        importMenuPos &&
        createPortal(
          <div
            className="toolbar-dropdown-menu"
            ref={importMenuRef}
            style={{ top: importMenuPos.top, left: importMenuPos.left }}
          >
            <button
              className="toolbar-dropdown-item"
              title="Open a saved .pcad document"
              onClick={handleLoadClick}
            >
              Load document (.pcad)
            </button>
            <button
              className="toolbar-dropdown-item"
              title="Import an STL mesh as a solid body"
              onClick={() => handleImportKind(".stl")}
            >
              Import STL
            </button>
            <button
              className="toolbar-dropdown-item"
              title="Import a STEP file as a solid body"
              onClick={() => handleImportKind(".step,.stp")}
            >
              Import STEP
            </button>
            <button
              className="toolbar-dropdown-item"
              title={
                isSketch
                  ? "Import SVG paths as sketch geometry"
                  : "Select a sketch first — SVG imports into a sketch"
              }
              disabled={!isSketch}
              onClick={() => handleImportKind(".svg")}
            >
              Import SVG
            </button>
            <button
              className="toolbar-dropdown-item"
              title={
                !isSketch
                  ? "Select a sketch first — an underlay is placed in a sketch"
                  : selectedItem?.underlay
                    ? "Reposition, rescale or remove this sketch's tracing image"
                    : "Place a PNG/JPEG on the sketch plane as a tracing guide"
              }
              disabled={!isSketch}
              onClick={() => {
                if (selectedItem?.underlay) {
                  // Edit in place: seed the bar from the committed values and
                  // remember them so Cancel/Esc can put them back.
                  setImportMenuOpen(false);
                  setUnderlayImport({
                    ...selectedItem.underlay,
                    sketchId: selectedId,
                    editing: true,
                    original: selectedItem.underlay,
                  });
                } else handleImportKind(".png,.jpg,.jpeg");
              }}
            >
              {selectedItem?.underlay
                ? "Edit image underlay…"
                : "Import image underlay"}
            </button>
          </div>,
          document.body,
        )}
      <button
        className="toolbar-btn"
        title="Variables"
        onClick={() => setVariablesDialogOpen(true)}
      >
        <SvgIcon name="variables" size={20} />
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
