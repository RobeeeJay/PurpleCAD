import React, { useRef } from "react";
import * as THREE from "three";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";

const buildExportMeshes = (items, targetGroup) => {
  items.forEach((item) => {
    let geometry;
    switch (item.type) {
      case "cube":     geometry = new THREE.BoxGeometry(2, 2, 2); break;
      case "sphere":   geometry = new THREE.SphereGeometry(1.5, 32, 32); break;
      case "cylinder": geometry = new THREE.CylinderGeometry(1, 1, 2, 32); break;
      case "torus":    geometry = new THREE.TorusGeometry(1.0, 0.4, 16, 32); break;
      case "sketch":   geometry = new THREE.PlaneGeometry(3, 3); break;
      default: return;
    }
    const mesh = new THREE.Mesh(geometry);
    const p = item.position;
    mesh.position.set(p ? p.x : 0, p ? p.y : 2, p ? p.z : 0);
    mesh.scale.setScalar(item.scale ? item.scale.x : 1);
    const r = item.rotation;
    if (r) mesh.rotation.set(r.x || 0, r.y || 0, r.z || 0);
    targetGroup.add(mesh);
  });
};

const DocumentSection = () => {
  const history = useStore((s) => s.history);
  const activeHistoryId = useStore((s) => s.activeHistoryId);
  const newDocument = useStore((s) => s.newDocument);
  const loadDocument = useStore((s) => s.loadDocument);
  const items = useStore((s) => s.items);

  const fileInputRef = useRef(null);

  const handleNew = () => {
    if (window.confirm("Create a new document? All current objects and timeline history will be cleared."))
      newDocument();
  };

  const handleSave = () => {
    const blob = new Blob([JSON.stringify({ version: 1, history, activeHistoryId }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "scene.cad.json"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleLoadClick = () => { fileInputRef.current.value = ""; fileInputRef.current.click(); };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.history || !Array.isArray(data.history)) { alert("Invalid document file."); return; }
        if (window.confirm("Load this document? All current objects and timeline history will be cleared."))
          loadDocument(data);
      } catch (err) { alert("Failed to read document: " + err.message); }
    };
    reader.readAsText(file);
  };

  const handleExportSTL = () => {
    if (items.length === 0) { alert("No objects to export."); return; }
    const scene = new THREE.Scene();
    const exportGroup = new THREE.Group();
    exportGroup.rotation.x = -Math.PI / 2;
    scene.add(exportGroup);
    buildExportMeshes(items, exportGroup);
    scene.updateMatrixWorld(true);
    const stlData = new STLExporter().parse(scene, { binary: true });
    const blob = new Blob([stlData], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "scene.stl"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportSTEP = () => {
    if (items.length === 0) { alert("No objects to export."); return; }

    let _id = 10;
    const eid = () => `#${_id++}`;
    const lines = [];
    const add = (id, def) => lines.push(`${id}=${def};`);

    add("#1", "APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
    add("#2", "APPLICATION_PROTOCOL_DEFINITION('international standard','ap242_managed_model_based_3d_engineering',2011,#1)");
    add("#3", "( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#4)) GLOBAL_UNIT_ASSIGNED_CONTEXT((#5,#6,#7)) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY') )");
    add("#4", "UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#5,'distance_accuracy_value','confusion accuracy')");
    add("#5", "( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )");
    add("#6", "( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )");
    add("#7", "( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )");

    const correction = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    const solidIds = [];

    items.forEach((item) => {
      let geometry;
      switch (item.type) {
        case "cube":     geometry = new THREE.BoxGeometry(2, 2, 2); break;
        case "sphere":   geometry = new THREE.SphereGeometry(1.5, 32, 32); break;
        case "cylinder": geometry = new THREE.CylinderGeometry(1, 1, 2, 32); break;
        case "torus":    geometry = new THREE.TorusGeometry(1.0, 0.4, 16, 32); break;
        case "sketch":   geometry = new THREE.PlaneGeometry(3, 3); break;
        default: return;
      }
      const p = item.position || { x: 0, y: 2, z: 0 };
      const s = item.scale ? item.scale.x : 1;
      const r = item.rotation || { x: 0, y: 0, z: 0 };
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(p.x, p.y, p.z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(r.x || 0, r.y || 0, r.z || 0)),
        new THREE.Vector3(s, s, s),
      );
      matrix.premultiply(correction);

      const posAttr = geometry.getAttribute("position");
      const indexAttr = geometry.index;
      const tmp = new THREE.Vector3();
      const coordStr = Array.from({ length: posAttr.count }, (_, i) => {
        tmp.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
        tmp.applyMatrix4(matrix);
        return `(${tmp.x.toFixed(6)},${tmp.y.toFixed(6)},${tmp.z.toFixed(6)})`;
      }).join(",");

      const tris = [];
      if (indexAttr) {
        for (let i = 0; i < indexAttr.count; i += 3)
          tris.push(`(${indexAttr.getX(i)},${indexAttr.getX(i+1)},${indexAttr.getX(i+2)})`);
      } else {
        for (let i = 0; i < posAttr.count; i += 3) tris.push(`(${i},${i+1},${i+2})`);
      }

      const coordId = eid();
      add(coordId, `CARTESIAN_POINT_LIST_3D('',(${coordStr}))`);
      const faceId = eid();
      add(faceId, `TRIANGULATED_FACE('${item.name || item.type}',${coordId},2,$,(${tris.join(",")}))`);
      const shellId = eid();
      add(shellId, `TESSELLATED_SHELL('',(${faceId}),$)`);
      const solidId = eid();
      add(solidId, `TESSELLATED_SOLID('${item.name || item.type}',(${shellId}),$)`);
      solidIds.push(solidId);
      geometry.dispose();
    });

    const reprId = eid(), prodCtxId = eid(), prodId = eid(), prodFormId = eid();
    const prodDefCtxId = eid(), prodDefId = eid(), prodDefShapeId = eid(), shapeDefReprId = eid();
    add(reprId,       `TESSELLATED_SHAPE_REPRESENTATION('',(${solidIds.join(",")}),#3)`);
    add(prodCtxId,    `PRODUCT_CONTEXT('',#1,'mechanical')`);
    add(prodId,       `PRODUCT('Scene','Scene','',(${prodCtxId}))`);
    add(prodFormId,   `PRODUCT_DEFINITION_FORMATION('','',${prodId})`);
    add(prodDefCtxId, `PRODUCT_DEFINITION_CONTEXT('part definition',#1,'design')`);
    add(prodDefId,    `PRODUCT_DEFINITION('design','',${prodFormId},${prodDefCtxId})`);
    add(prodDefShapeId, `PRODUCT_DEFINITION_SHAPE('','',${prodDefId})`);
    add(shapeDefReprId, `SHAPE_DEFINITION_REPRESENTATION(${prodDefShapeId},${reprId})`);

    const content = [
      "ISO-10303-21;", "HEADER;",
      "FILE_DESCRIPTION(('CAD Scene Export'),'2;1');",
      `FILE_NAME('scene.step','${new Date().toISOString()}',(''),(''),'','','');`,
      "FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 }'));",
      "ENDSEC;", "DATA;", ...lines, "ENDSEC;", "END-ISO-10303-21;",
    ].join("\n");

    const blob = new Blob([content], { type: "application/step" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "scene.step"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ToolbarSection label="Document">
      <button className="toolbar-btn" title="New document" onClick={handleNew}>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M6 2h9l5 5v15H6V2z" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M14 2v6h6" fill="none" stroke="currentColor" strokeWidth="2" />
          <line x1="9" y1="12" x2="15" y2="12" stroke="currentColor" strokeWidth="2" />
          <line x1="12" y1="9" x2="12" y2="15" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      <button className="toolbar-btn" title="Save document" onClick={handleSave}>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <rect x="3" y="3" width="18" height="18" rx="1" fill="none" stroke="currentColor" strokeWidth="2" />
          <rect x="7" y="3" width="10" height="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <rect x="6" y="13" width="12" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
      <button className="toolbar-btn" title="Load document" onClick={handleLoadClick}>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M3 7h5l2-3h6l2 3h3v13H3V7z" fill="none" stroke="currentColor" strokeWidth="2" />
          <polyline points="12,11 12,18" stroke="currentColor" strokeWidth="2" />
          <polyline points="9,15 12,18 15,15" stroke="currentColor" strokeWidth="2" />
        </svg>
      </button>
      <button className="toolbar-btn" title="Export as STL" onClick={handleExportSTL}>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M12 3v11m0 0l-4-4m4 4l4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 17v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <text x="12" y="10" textAnchor="middle" fontSize="5.5" fontWeight="bold" fill="currentColor" fontFamily="monospace">STL</text>
        </svg>
      </button>
      <button className="toolbar-btn" title="Export as STEP" onClick={handleExportSTEP}>
        <svg viewBox="0 0 24 24" width="20" height="20">
          <path d="M12 3v11m0 0l-4-4m4 4l4-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 17v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <text x="12" y="10" textAnchor="middle" fontSize="5" fontWeight="bold" fill="currentColor" fontFamily="monospace">STP</text>
        </svg>
      </button>
      <input ref={fileInputRef} type="file" accept=".json,.cad.json" style={{ display: "none" }} onChange={handleFileChange} />
    </ToolbarSection>
  );
};

export default DocumentSection;
