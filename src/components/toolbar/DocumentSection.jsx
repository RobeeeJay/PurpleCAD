import React, { useRef } from "react";
import * as THREE from "three";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { buildItemShapeLocal } from "../../three/csgUtils.js";
import { transformShape } from "../../three/occ/operations.js";
import { tessellate } from "../../three/occ/tessellate.js";
import { ensureOcc, getOcc } from "../../three/occ/init.js";
import { MM_PER_UNIT } from "../../three/sceneObjects.js";

const EXPORTABLE_TYPES = new Set([
  "cube",
  "sphere",
  "cylinder",
  "torus",
  "extrude",
  "csg",
]);

// Build each exportable item's OCC shape in WORLD space (position + rotation
// applied, then scaled by item.scale, then by MM_PER_UNIT so the output is
// in millimetres — the conventional unit for STL/STEP).  Returns an array
// of TopoDS_Shape.
function buildWorldShapes(items) {
  const oc = getOcc();
  const out = [];
  for (const item of items) {
    if (item.visible === false) continue;
    if (!EXPORTABLE_TYPES.has(item.type)) continue;
    const local = buildItemShapeLocal(item, items);
    if (!local) continue;
    const positioned = transformShape(local, item.position, item.rotation);
    if (!positioned) continue;
    const sceneScale = item.scale ? item.scale.x : 1;
    const finalScale = sceneScale * MM_PER_UNIT;
    if (Math.abs(finalScale - 1) < 1e-9) {
      out.push(positioned);
      continue;
    }
    const trsf = new oc.gp_Trsf_1();
    trsf.SetScaleFactor(finalScale);
    const mk = new oc.BRepBuilderAPI_Transform_2(positioned, trsf, true);
    out.push(mk.Shape());
  }
  return out;
}

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

  const handleExportSTL = async () => {
    if (items.length === 0) {
      alert("No objects to export.");
      return;
    }
    try {
      await ensureOcc();
      const shapes = buildWorldShapes(items);
      if (shapes.length === 0) {
        alert("No exportable objects in the scene.");
        return;
      }
      // Tessellate each shape with print-quality deflection and add as a
      // Mesh to a temporary scene; STLExporter walks meshes and writes
      // their position attributes.  Rotate +π/2 around X so the app's
      // +Y (viewport "up") maps to +Z (the Z-up convention used by every
      // mainstream STL viewer) — without this the object appears upside
      // down in external viewers and doesn't match the in-app orientation.
      const scene = new THREE.Scene();
      const exportGroup = new THREE.Group();
      exportGroup.rotation.x = Math.PI / 2;
      scene.add(exportGroup);
      for (const shape of shapes) {
        const geo = tessellate(shape, 0.01);
        if (!geo) continue;
        const mesh = new THREE.Mesh(geo);
        exportGroup.add(mesh);
      }
      scene.updateMatrixWorld(true);
      const stlData = new STLExporter().parse(scene, { binary: true });
      const blob = new Blob([stlData], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "scene.stl";
      a.click();
      URL.revokeObjectURL(url);
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
      await ensureOcc();
      const oc = getOcc();
      const shapes = buildWorldShapes(items);
      if (shapes.length === 0) {
        alert("No exportable objects in the scene.");
        return;
      }
      // STEPControl_Writer accumulates shapes via .Transfer; STEPControl_AsIs
      // tells the writer to pick the best representation for each shape
      // (B-rep solids stay as solids, etc.) — this produces files that
      // FreeCAD, Fusion, SolidWorks, and other CAD readers open natively.
      // This binding of OCC predates Message_ProgressRange, so Transfer's
      // signature is (shape, mode, compgraph).
      const writer = new oc.STEPControl_Writer_1();
      const mode = oc.STEPControl_StepModelType.STEPControl_AsIs;
      // Y-up → Z-up: STEP's de-facto convention is Z-up (matches FreeCAD,
      // Fusion, SolidWorks).  Apply +π/2 around X so the viewport's "up"
      // direction lines up with the receiving CAD app's "up".
      for (const shape of shapes) {
        const oriented = transformShape(shape, null, { x: Math.PI / 2 });
        writer.Transfer(oriented, mode, true);
      }
      // OCC.js marshals the JS filename string through a transient heap
      // allocation, and in this build the path ends up garbled in the
      // virtual FS.  Snapshot the FS before/after Write so we can locate
      // the actually-created file rather than trusting the filename we
      // passed.
      const before = new Set(oc.FS.readdir("/"));
      writer.Write("scene.step");
      const writtenName = oc.FS.readdir("/").find((n) => !before.has(n));
      if (!writtenName) {
        throw new Error("STEP writer did not produce a file");
      }
      const fileContent = oc.FS.readFile("/" + writtenName, {
        encoding: "utf8",
      });
      try {
        oc.FS.unlink("/" + writtenName);
      } catch {
        /* best-effort cleanup */
      }
      if (!fileContent || fileContent.length < 100) {
        throw new Error("STEP writer produced an empty or truncated file");
      }
      if (!fileContent.startsWith("ISO-10303-21;")) {
        throw new Error("STEP writer produced an invalid header");
      }
      const blob = new Blob([fileContent], { type: "application/step" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "scene.step";
      a.click();
      URL.revokeObjectURL(url);
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
