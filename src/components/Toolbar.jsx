import React, { useRef } from "react";
import * as THREE from "three";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { Evaluator, Brush, ADDITION, SUBTRACTION, INTERSECTION } from "three-bvh-csg";
import { useStore } from "../store";
import "../styles/Toolbar.css";

const Toolbar = () => {
  const addItem = useStore((state) => state.addItem);
  const setSketchPlacementMode = useStore((state) => state.setSketchPlacementMode);
  const toggleTheme = useStore((state) => state.toggleTheme);
  const theme = useStore((state) => state.theme);
  const renderMode = useStore((state) => state.renderMode);
  const setRenderMode = useStore((state) => state.setRenderMode);
  const projectionMode = useStore((state) => state.projectionMode);
  const toggleProjectionMode = useStore((state) => state.toggleProjectionMode);
  const items = useStore((state) => state.items);
  const widgetVisible = useStore((state) => state.widgetVisible);
  const toggleWidgetVisibility = useStore(
    (state) => state.toggleWidgetVisibility,
  );
  const axisVisible = useStore((state) => state.axisVisible);
  const toggleAxisVisibility = useStore((state) => state.toggleAxisVisibility);
  const history = useStore((state) => state.history);
  const activeHistoryId = useStore((state) => state.activeHistoryId);
  const newDocument = useStore((state) => state.newDocument);
  const loadDocument = useStore((state) => state.loadDocument);
  const selectedIds = useStore((state) => state.selectedIds);
  const setItemsHidden = useStore((state) => state.setItemsHidden);
  const activeSketchTool = useStore((state) => state.activeSketchTool);
  const setActiveSketchTool = useStore((state) => state.setActiveSketchTool);
  const sketchConstraintMode = useStore((state) => state.sketchConstraintMode);
  const setSketchConstraintMode = useStore((state) => state.setSketchConstraintMode);
  const setSketchConstraintFirstPoint = useStore((state) => state.setSketchConstraintFirstPoint);
  const setSketchDistanceInput = useStore((state) => state.setSketchDistanceInput);
  const selectedSketchElement = useStore((state) => state.selectedSketchElement);
  const sketchModifyMode = useStore((state) => state.sketchModifyMode);
  const setSketchModifyMode = useStore((state) => state.setSketchModifyMode);
  const extrudeSelectMode = useStore((state) => state.extrudeSelectMode);
  const setExtrudeSelectMode = useStore((state) => state.setExtrudeSelectMode);
  const setExtrudeRetargetId = useStore((state) => state.setExtrudeRetargetId);
  const applySketchHVConstraint = useStore((state) => state.applySketchHVConstraint);
  const constraintsVisible = useStore((state) => state.constraintsVisible);
  const toggleConstraintsVisible = useStore((state) => state.toggleConstraintsVisible);
  const sketchMultiSelectedIndices = useStore((state) => state.sketchMultiSelectedIndices);
  const toggleSketchShapesDashed = useStore((state) => state.toggleSketchShapesDashed);

  const selectedId = useStore((state) => state.selectedId);
  const isSketchMode = !!(selectedId && items.find((i) => i.id === selectedId)?.type === "sketch");

  const handleCoincidentConstraint = () => {
    if (sketchConstraintMode === "coincident") {
      setSketchConstraintMode(null);
      setSketchConstraintFirstPoint(null);
    } else {
      setSketchConstraintMode("coincident");
      setSketchDistanceInput(null);
      if (selectedSketchElement?.type === "point") {
        setSketchConstraintFirstPoint({ shapeIdx: selectedSketchElement.shapeIdx, pointKey: selectedSketchElement.pointKey });
      }
    }
  };

  const handleDistanceConstraint = () => {
    if (sketchConstraintMode === "distance") {
      setSketchConstraintMode(null);
      setSketchConstraintFirstPoint(null);
      setSketchDistanceInput(null);
    } else {
      setSketchConstraintMode("distance");
      setSketchConstraintFirstPoint(null);
      setSketchDistanceInput(null);
    }
  };

  const handleToggleDashed = () => {
    const indices = sketchMultiSelectedIndices.length > 0
      ? sketchMultiSelectedIndices
      : selectedSketchElement?.type === "line"
      ? [selectedSketchElement.shapeIdx]
      : [];
    if (indices.length > 0) toggleSketchShapesDashed(selectedId, indices);
  };

  const SKETCH_TOOLS = [
    { id: "rect",    label: "Rectangle", icon: <svg viewBox="0 0 24 24" width="20" height="20"><rect x="3" y="6" width="18" height="12" fill="none" stroke="currentColor" strokeWidth="2" /></svg> },
    { id: "circle",  label: "Circle",    icon: <svg viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /></svg> },
    { id: "ellipse", label: "Ellipse",   icon: <svg viewBox="0 0 24 24" width="20" height="20"><ellipse cx="12" cy="12" rx="10" ry="6" fill="none" stroke="currentColor" strokeWidth="2" /></svg> },
    { id: "line",    label: "Line",      icon: <svg viewBox="0 0 24 24" width="20" height="20"><line x1="4" y1="20" x2="20" y2="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> },
    { id: "arc",     label: "Arc",       icon: <svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 20 Q12 2 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg> },
    { id: "bezier",  label: "Bezier",    icon: <svg viewBox="0 0 24 24" width="20" height="20"><path d="M3 20 C6 4 18 4 21 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="3" cy="20" r="2" fill="currentColor" /><circle cx="6" cy="4" r="1.5" fill="currentColor" opacity="0.6" /><circle cx="18" cy="4" r="1.5" fill="currentColor" opacity="0.6" /><circle cx="21" cy="20" r="2" fill="currentColor" /></svg> },
  ];

  const fileInputRef = useRef(null);

  const createItem = (type) => {
    let maxId = 0;
    history.forEach(function (entry) {
      if (entry.instruction && entry.instruction.type === "create") {
        if (entry.instruction.item.id > maxId) maxId = entry.instruction.item.id;
      }
    });
    const id = maxId + 1;
    const label = type.charAt(0).toUpperCase() + type.slice(1);
    addItem({
      id,
      name: `${label} ${id}`,
      type,
      children: [],
      position: { x: 0, y: 2, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
  };

  const buildItemGeometry = (item) => {
    switch (item.type) {
      case "cube": return new THREE.BoxGeometry(2, 2, 2);
      case "sphere": return new THREE.SphereGeometry(1.5, 32, 32);
      case "cylinder": return new THREE.CylinderGeometry(1, 1, 2, 32);
      case "torus": return new THREE.TorusGeometry(1.0, 0.4, 16, 32);
      case "csg": {
        if (!item.geometryData) return null;
        const { positions, normals, indices } = item.geometryData;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
        if (normals) geo.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normals), 3));
        if (indices) geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
        if (!normals) geo.computeVertexNormals();
        return geo;
      }
      default: return null;
    }
  };

  const handleCsg = (operation) => {
    if (selectedIds.length < 2) return;
    const selectedItems = selectedIds
      .map((id) => items.find((i) => i.id === id))
      .filter((item) => item && item.type !== "sketch");
    if (selectedItems.length < 2) return;

    try {
      const evaluator = new Evaluator();
      const sharedMat = new THREE.MeshStandardMaterial();
      let result = null;

      for (const item of selectedItems) {
        const geo = buildItemGeometry(item);
        if (!geo) continue;
        if (!geo.getAttribute("uv")) {
          const count = geo.getAttribute("position").count;
          geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
        }
        const brush = new Brush(geo, sharedMat);
        const p = item.position || { x: 0, y: 2, z: 0 };
        const s = item.scale ? item.scale.x : 1;
        const r = item.rotation || { x: 0, y: 0, z: 0 };
        brush.position.set(p.x, p.y, p.z);
        brush.scale.setScalar(s);
        brush.rotation.set(r.x || 0, r.y || 0, r.z || 0);
        brush.updateMatrixWorld();

        if (result === null) {
          result = brush;
        } else {
          const op = operation === "union" ? ADDITION : operation === "difference" ? SUBTRACTION : INTERSECTION;
          result = evaluator.evaluate(result, brush, op);
        }
      }

      if (!result) return;

      const posAttr = result.geometry.getAttribute("position");
      const normAttr = result.geometry.getAttribute("normal");
      const idxAttr = result.geometry.index;

      // Compute bounding-box centre and re-centre geometry so local origin = centre of mass
      const bbox = new THREE.Box3().setFromBufferAttribute(posAttr);
      const centre = new THREE.Vector3();
      bbox.getCenter(centre);
      for (let i = 0; i < posAttr.count; i++) {
        posAttr.setXYZ(i, posAttr.getX(i) - centre.x, posAttr.getY(i) - centre.y, posAttr.getZ(i) - centre.z);
      }
      posAttr.needsUpdate = true;

      const geometryData = {
        positions: Array.from(posAttr.array),
        normals: normAttr ? Array.from(normAttr.array) : null,
        indices: idxAttr ? Array.from(idxAttr.array) : null,
      };

      let maxId = 0;
      history.forEach((entry) => {
        if (entry.instruction?.type === "create" && entry.instruction.item.id > maxId)
          maxId = entry.instruction.item.id;
      });
      const id = maxId + 1;
      const opLabel = operation.charAt(0).toUpperCase() + operation.slice(1);
      const sourceIds = selectedItems.map((i) => i.id);
      addItem({
        id,
        name: `${opLabel} ${id}`,
        type: "csg",
        children: [],
        position: { x: centre.x, y: centre.y, z: centre.z },
        scale: { x: 1, y: 1, z: 1 },
        rotation: { x: 0, y: 0, z: 0 },
        geometryData,
      });
      setItemsHidden(sourceIds);

      sharedMat.dispose();
    } catch (err) {
      console.error("CSG operation failed:", err);
      alert("Boolean operation failed: " + err.message);
    }
  };

  const handleNew = () => {
    const ok = window.confirm(
      "Create a new document? All current objects and timeline history will be cleared.",
    );
    if (ok) newDocument();
  };

  const handleSave = () => {
    const doc = { version: 1, history, activeHistoryId };
    const json = JSON.stringify(doc, null, 2);
    const blob = new Blob([json], { type: "application/json" });
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

  const buildExportMeshes = (targetGroup) => {
    items.forEach((item) => {
      let geometry;
      switch (item.type) {
        case "cube":
          geometry = new THREE.BoxGeometry(2, 2, 2);
          break;
        case "sphere":
          geometry = new THREE.SphereGeometry(1.5, 32, 32);
          break;
        case "cylinder":
          geometry = new THREE.CylinderGeometry(1, 1, 2, 32);
          break;
        case "torus":
          geometry = new THREE.TorusGeometry(1.0, 0.4, 16, 32);
          break;
        case "sketch":
          geometry = new THREE.PlaneGeometry(3, 3);
          break;
        default:
          return;
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

  const handleExportSTL = () => {
    if (items.length === 0) {
      alert("No objects to export.");
      return;
    }
    const scene = new THREE.Scene();
    // Rotate -90° around X to convert Y-up (Three.js) → Z-up (STL convention)
    const exportGroup = new THREE.Group();
    exportGroup.rotation.x = -Math.PI / 2;
    scene.add(exportGroup);
    buildExportMeshes(exportGroup);
    scene.updateMatrixWorld(true);
    const stlData = new STLExporter().parse(scene, { binary: true });
    const blob = new Blob([stlData], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scene.stl";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportSTEP = () => {
    if (items.length === 0) {
      alert("No objects to export.");
      return;
    }

    let _id = 10;
    const eid = () => `#${_id++}`;
    const lines = [];
    const add = (id, def) => lines.push(`${id}=${def};`);

    // Geometry context with SI millimetre units
    add("#1", "APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
    add("#2", "APPLICATION_PROTOCOL_DEFINITION('international standard','ap242_managed_model_based_3d_engineering',2011,#1)");
    add("#3", "( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#4)) GLOBAL_UNIT_ASSIGNED_CONTEXT((#5,#6,#7)) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY') )");
    add("#4", "UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),#5,'distance_accuracy_value','confusion accuracy')");
    add("#5", "( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )");
    add("#6", "( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )");
    add("#7", "( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )");

    // Y-up (Three.js) → Z-up (STEP/CAD convention)
    const correction = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
    const solidIds = [];

    items.forEach((item) => {
      let geometry;
      switch (item.type) {
        case "cube":
          geometry = new THREE.BoxGeometry(2, 2, 2);
          break;
        case "sphere":
          geometry = new THREE.SphereGeometry(1.5, 32, 32);
          break;
        case "cylinder":
          geometry = new THREE.CylinderGeometry(1, 1, 2, 32);
          break;
        case "torus":
          geometry = new THREE.TorusGeometry(1.0, 0.4, 16, 32);
          break;
        case "sketch":
          geometry = new THREE.PlaneGeometry(3, 3);
          break;
        default:
          return;
      }

      const p = item.position || { x: 0, y: 2, z: 0 };
      const s = item.scale ? item.scale.x : 1;
      const r = item.rotation || { x: 0, y: 0, z: 0 };
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3(p.x, p.y, p.z),
        new THREE.Quaternion().setFromEuler(
          new THREE.Euler(r.x || 0, r.y || 0, r.z || 0),
        ),
        new THREE.Vector3(s, s, s),
      );
      matrix.premultiply(correction);

      const posAttr = geometry.getAttribute("position");
      const indexAttr = geometry.index;
      const tmp = new THREE.Vector3();

      const coordStr = Array.from(
        { length: posAttr.count },
        (_, i) => {
          tmp.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
          tmp.applyMatrix4(matrix);
          return `(${tmp.x.toFixed(6)},${tmp.y.toFixed(6)},${tmp.z.toFixed(6)})`;
        },
      ).join(",");

      const tris = [];
      if (indexAttr) {
        for (let i = 0; i < indexAttr.count; i += 3)
          tris.push(`(${indexAttr.getX(i)},${indexAttr.getX(i + 1)},${indexAttr.getX(i + 2)})`);
      } else {
        for (let i = 0; i < posAttr.count; i += 3)
          tris.push(`(${i},${i + 1},${i + 2})`);
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

    const reprId = eid();
    add(reprId, `TESSELLATED_SHAPE_REPRESENTATION('',(${solidIds.join(",")}),#3)`);
    const prodCtxId = eid();
    const prodId = eid();
    const prodFormId = eid();
    const prodDefCtxId = eid();
    const prodDefId = eid();
    const prodDefShapeId = eid();
    const shapeDefReprId = eid();
    add(prodCtxId, `PRODUCT_CONTEXT('',#1,'mechanical')`);
    add(prodId, `PRODUCT('Scene','Scene','',(${prodCtxId}))`);
    add(prodFormId, `PRODUCT_DEFINITION_FORMATION('','',${prodId})`);
    add(prodDefCtxId, `PRODUCT_DEFINITION_CONTEXT('part definition',#1,'design')`);
    add(prodDefId, `PRODUCT_DEFINITION('design','',${prodFormId},${prodDefCtxId})`);
    add(prodDefShapeId, `PRODUCT_DEFINITION_SHAPE('','',${prodDefId})`);
    add(shapeDefReprId, `SHAPE_DEFINITION_REPRESENTATION(${prodDefShapeId},${reprId})`);

    const content = [
      "ISO-10303-21;",
      "HEADER;",
      "FILE_DESCRIPTION(('CAD Scene Export'),'2;1');",
      `FILE_NAME('scene.step','${new Date().toISOString()}',(''),(''),'','','');`,
      "FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 }'));",
      "ENDSEC;",
      "DATA;",
      ...lines,
      "ENDSEC;",
      "END-ISO-10303-21;",
    ].join("\n");

    const blob = new Blob([content], { type: "application/step" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scene.step";
    a.click();
    URL.revokeObjectURL(url);
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
        const ok = window.confirm(
          "Load this document? All current objects and timeline history will be cleared.",
        );
        if (ok) loadDocument(data);
      } catch (err) {
        alert("Failed to read document: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="toolbar">
      {/* Document Section */}
      <div className="toolbar-section">
        <div className="toolbar-label">Document</div>
        <div className="toolbar-buttons">
          <button
            className="toolbar-btn"
            title="New document"
            onClick={handleNew}
          >
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
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.cad.json"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
        </div>
      </div>

      {/* Create / Draw Section */}
      <div className="toolbar-section">
        <div className="toolbar-label">{isSketchMode ? "Draw" : "Create"}</div>
        <div className="toolbar-buttons">
          {isSketchMode ? (
            SKETCH_TOOLS.map((tool) => (
              <button
                key={tool.id}
                className={`toolbar-btn ${activeSketchTool === tool.id ? "active" : ""}`}
                title={tool.label}
                onClick={() => setActiveSketchTool(activeSketchTool === tool.id ? null : tool.id)}
              >
                {tool.icon}
              </button>
            ))
          ) : (
            <>
              <button
                className="toolbar-btn"
                title="Sketch Plane"
                onClick={() => setSketchPlacementMode(true)}
              >
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <rect x="3" y="3" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" />
                  <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="1" />
                  <line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" strokeWidth="1" />
                </svg>
              </button>
              <button className="toolbar-btn" title="Cube" onClick={() => createItem("cube")}>
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path d="M3 5v12h18V5M3 5l9-4 9 4m0 12l-9 4-9-4" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              <button className="toolbar-btn" title="Sphere" onClick={() => createItem("sphere")}>
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
                  <ellipse cx="12" cy="12" rx="3" ry="9" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.5" />
                </svg>
              </button>
              <button className="toolbar-btn" title="Cylinder" onClick={() => createItem("cylinder")}>
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <ellipse cx="12" cy="6" rx="7" ry="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
                  <ellipse cx="12" cy="18" rx="7" ry="2.5" fill="none" stroke="currentColor" strokeWidth="2" />
                  <line x1="5" y1="6" x2="5" y2="18" stroke="currentColor" strokeWidth="2" />
                  <line x1="19" y1="6" x2="19" y2="18" stroke="currentColor" strokeWidth="2" />
                </svg>
              </button>
              <button className="toolbar-btn" title="Torus" onClick={() => createItem("torus")}>
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <ellipse cx="12" cy="12" rx="9" ry="4.5" fill="none" stroke="currentColor" strokeWidth="2" />
                  <ellipse cx="12" cy="12" rx="4" ry="2" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
                </svg>
              </button>
              <button
                className={`toolbar-btn ${extrudeSelectMode ? "active" : ""}`}
                title="Extrude — click an enclosed sketch region or flat face"
                onClick={() => setExtrudeSelectMode(extrudeSelectMode ? null : "profile")}
              >
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <rect x="4" y="14" width="16" height="6" fill="none" stroke="currentColor" strokeWidth="2" />
                  <polygon points="4,14 8,8 20,8 20,14" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.7" />
                  <line x1="12" y1="8" x2="12" y2="3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <polyline points="9,5 12,2 15,5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Modify Section — sketch mode only */}
      {isSketchMode && (
        <div className="toolbar-section">
          <div className="toolbar-label">Modify</div>
          <div className="toolbar-buttons">
            <button
              className={`toolbar-btn ${sketchModifyMode === "chamfer" ? "active" : ""}`}
              title="Chamfer — trim two connected lines and join with a straight edge"
              onClick={() => setSketchModifyMode(sketchModifyMode === "chamfer" ? null : "chamfer")}
            >
              <svg viewBox="0 0 24 24" width="20" height="20">
                <polyline points="4,20 4,8 14,8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <line x1="4" y1="8" x2="14" y2="20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <circle cx="4" cy="8" r="2" fill="currentColor" />
              </svg>
            </button>
            <button
              className={`toolbar-btn ${sketchModifyMode === "bevel" ? "active" : ""}`}
              title="Bevel — trim two connected lines and join with a smooth arc"
              onClick={() => setSketchModifyMode(sketchModifyMode === "bevel" ? null : "bevel")}
            >
              <svg viewBox="0 0 24 24" width="20" height="20">
                <polyline points="4,20 4,8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                <line x1="14" y1="8" x2="20" y2="8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M4,8 Q4,8 14,8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M4,20 L4,10 Q4,8 6,8 L14,8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                <circle cx="4" cy="10" r="1.5" fill="currentColor" opacity="0.5" />
              </svg>
            </button>
            <button
              className="toolbar-btn"
              title="Toggle Dashed — dashed lines constrain geometry but don't form closed regions or extrusions"
              disabled={sketchMultiSelectedIndices.length === 0 && selectedSketchElement?.type !== "line"}
              onClick={handleToggleDashed}
            >
              <svg viewBox="0 0 24 24" width="20" height="20">
                <line x1="3" y1="12" x2="21" y2="12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 3" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Extrude retarget — visible when an extrude object is selected */}
      {!isSketchMode && items.find((i) => i.id === selectedId)?.type === "extrude" && (
        <div className="toolbar-section">
          <div className="toolbar-label">Extrude</div>
          <div className="toolbar-buttons">
            <button
              className={`toolbar-btn ${extrudeSelectMode === "profile" ? "active" : ""}`}
              title="Retarget Profile — pick a new face or sketch region to extrude from"
              onClick={() => {
                setExtrudeRetargetId(selectedId);
                setExtrudeSelectMode("profile");
              }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20">
                <rect x="3" y="14" width="12" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="2" />
                <polygon points="3,14 6,9 18,9 18,14" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
                <circle cx="19" cy="5" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <line x1="19" y1="2" x2="19" y2="1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="19" y1="8" x2="19" y2="9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="16" y1="5" x2="15" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <line x1="22" y1="5" x2="23" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                <circle cx="19" cy="5" r="1" fill="currentColor" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Combine Section */}
      <div className="toolbar-section">
        <div className="toolbar-label">Combine</div>
        <div className="toolbar-buttons">
          {(() => {
            const csgEligible = selectedIds.filter((id) => {
              const item = items.find((i) => i.id === id);
              return item && item.type !== "sketch";
            });
            const canCsg = csgEligible.length >= 2;
            return (
              <>
                <button
                  className="toolbar-btn"
                  title="Union"
                  disabled={!canCsg}
                  onClick={() => handleCsg("union")}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20">
                    <circle cx="8" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
                    <circle cx="16" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </button>
                <button
                  className="toolbar-btn"
                  title="Difference"
                  disabled={!canCsg}
                  onClick={() => handleCsg("difference")}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20">
                    <circle cx="8" cy="12" r="5" fill="currentColor" opacity="0.3" stroke="currentColor" strokeWidth="2" />
                    <circle cx="16" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </button>
                <button
                  className="toolbar-btn"
                  title="Intersection"
                  disabled={!canCsg}
                  onClick={() => handleCsg("intersection")}
                >
                  <svg viewBox="0 0 24 24" width="20" height="20">
                    <circle cx="8" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
                    <circle cx="16" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
                    <path d="M 11 9 Q 13 12 11 15" fill="currentColor" />
                  </svg>
                </button>
              </>
            );
          })()}
        </div>
      </div>

      {/* Constrain Section */}
      <div className="toolbar-section">
        <div className="toolbar-label">Constrain</div>
        <div className="toolbar-buttons">
          {isSketchMode && (<>
            <button
              className={`toolbar-btn ${sketchConstraintMode === "coincident" ? "active" : ""}`}
              title="Coincident — make two points share the same position"
              onClick={handleCoincidentConstraint}
            >
              <svg viewBox="0 0 24 24" width="20" height="20">
                <circle cx="12" cy="12" r="5" fill="none" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="12" r="2" fill="currentColor" />
                <line x1="12" y1="2" x2="12" y2="7" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 1" />
                <line x1="12" y1="17" x2="12" y2="22" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 1" />
              </svg>
            </button>
            <button
              className={`toolbar-btn ${sketchConstraintMode === "distance" ? "active" : ""}`}
              title="Distance — set a fixed distance between two points"
              onClick={handleDistanceConstraint}
            >
              <svg viewBox="0 0 24 24" width="20" height="20">
                <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 2" />
                <line x1="4" y1="8" x2="4" y2="16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <line x1="20" y1="8" x2="20" y2="16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <text x="12" y="10" textAnchor="middle" fontSize="6" fill="currentColor" fontFamily="sans-serif">d</text>
              </svg>
            </button>
            <button
              className="toolbar-btn"
              title="Horizontal — force the selected line to be horizontal"
              disabled={selectedSketchElement?.type !== "line"}
              onClick={() => {
                if (selectedSketchElement?.type === "line")
                  applySketchHVConstraint(selectedId, selectedSketchElement.shapeIdx, "horizontal");
              }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20">
                <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="2" />
                <circle cx="4" cy="12" r="2" fill="currentColor" />
                <circle cx="20" cy="12" r="2" fill="currentColor" />
              </svg>
            </button>
            <button
              className="toolbar-btn"
              title="Vertical — force the selected line to be vertical"
              disabled={selectedSketchElement?.type !== "line"}
              onClick={() => {
                if (selectedSketchElement?.type === "line")
                  applySketchHVConstraint(selectedId, selectedSketchElement.shapeIdx, "vertical");
              }}
            >
              <svg viewBox="0 0 24 24" width="20" height="20">
                <line x1="12" y1="4" x2="12" y2="20" stroke="currentColor" strokeWidth="2" />
                <circle cx="12" cy="4" r="2" fill="currentColor" />
                <circle cx="12" cy="20" r="2" fill="currentColor" />
              </svg>
            </button>
          </>)}
          {!isSketchMode && (
            <button className="toolbar-btn" title="Perpendicular">
              <svg viewBox="0 0 24 24" width="20" height="20">
                <line x1="4" y1="12" x2="12" y2="12" stroke="currentColor" strokeWidth="2" />
                <line x1="12" y1="12" x2="12" y2="20" stroke="currentColor" strokeWidth="2" />
                <rect x="10" y="10" width="4" height="4" fill="none" stroke="currentColor" strokeWidth="1" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Render Section */}
      <div className="toolbar-section">
        <div className="toolbar-label">Render</div>
        <div className="toolbar-buttons">
          <button
            className={`toolbar-btn ${renderMode === "wireframe" ? "active" : ""}`}
            title="Wireframe"
            onClick={() => setRenderMode("wireframe")}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path
                d="M3 5v14h18V5m0 7h-18m9-7v14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
          </button>
          <button
            className={`toolbar-btn ${renderMode === "shaded" ? "active" : ""}`}
            title="Shaded"
            onClick={() => setRenderMode("shaded")}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path
                d="M3 5v14h18V5z"
                fill="currentColor"
                opacity="0.3"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
          </button>
          <button
            className={`toolbar-btn ${renderMode === "smooth" ? "active" : ""}`}
            title="Smooth"
            onClick={() => setRenderMode("smooth")}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="currentColor" />
                  <stop
                    offset="100%"
                    stopColor="currentColor"
                    stopOpacity="0.3"
                  />
                </linearGradient>
              </defs>
              <path
                d="M3 5v14h18V5z"
                fill="url(#grad)"
                stroke="currentColor"
                strokeWidth="2"
              />
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
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
            onClick={toggleTheme}
          >
            {theme === "light" ? (
              <svg viewBox="0 0 24 24" width="20" height="20">
                <circle cx="12" cy="12" r="5" fill="currentColor" />
                <line
                  x1="12"
                  y1="1"
                  x2="12"
                  y2="3"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <line
                  x1="12"
                  y1="21"
                  x2="12"
                  y2="23"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <line
                  x1="4.22"
                  y1="4.22"
                  x2="5.64"
                  y2="5.64"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <line
                  x1="18.36"
                  y1="18.36"
                  x2="19.78"
                  y2="19.78"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <line
                  x1="1"
                  y1="12"
                  x2="3"
                  y2="12"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <line
                  x1="21"
                  y1="12"
                  x2="23"
                  y2="12"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <line
                  x1="4.22"
                  y1="19.78"
                  x2="5.64"
                  y2="18.36"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <line
                  x1="18.36"
                  y1="5.64"
                  x2="19.78"
                  y2="4.22"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path
                  d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
                  fill="currentColor"
                  stroke="currentColor"
                  strokeWidth="0"
                />
              </svg>
            )}
          </button>
          <button
            className={`toolbar-btn ${projectionMode === "isometric" ? "active" : ""}`}
            title={`Switch to ${projectionMode === "perspective" ? "isometric" : "perspective"} projection`}
            onClick={toggleProjectionMode}
          >
            {projectionMode === "perspective" ? (
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path
                  d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20">
                <path
                  d="M3 7l9-4 9 4v10l-9 4-9-4V7z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="M12 3v18"
                  stroke="currentColor"
                  strokeWidth="1"
                  opacity="0.5"
                />
                <path
                  d="M7 8l10 4.5M7 12l10-1"
                  stroke="currentColor"
                  strokeWidth="1"
                  opacity="0.5"
                />
              </svg>
            )}
          </button>
          <button
            className={`toolbar-btn ${widgetVisible ? "active" : ""}`}
            title={`${widgetVisible ? "Hide" : "Show"} orientation widget`}
            onClick={toggleWidgetVisibility}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path
                d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                fill={widgetVisible ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
          </button>
          <button
            className={`toolbar-btn ${constraintsVisible ? "active" : ""}`}
            title={`${constraintsVisible ? "Hide" : "Show"} constraint icons`}
            onClick={toggleConstraintsVisible}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path d="M12 3L21 12L12 21L3 12Z" fill="none" stroke="currentColor" strokeWidth="2" />
              {!constraintsVisible && <line x1="4" y1="20" x2="20" y2="4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />}
            </svg>
          </button>
          <button
            className={`toolbar-btn ${axisVisible ? "active" : ""}`}
            title={`${axisVisible ? "Hide" : "Show"} axis`}
            onClick={toggleAxisVisibility}
          >
            <svg viewBox="0 0 24 24" width="20" height="20">
              <line
                x1="12"
                y1="12"
                x2="21"
                y2="12"
                stroke="#ff4444"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <polygon points="23,12 20,10.5 20,13.5" fill="#ff4444" />
              <line
                x1="12"
                y1="12"
                x2="12"
                y2="3"
                stroke="#4488ff"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <polygon points="12,1 10.5,4 13.5,4" fill="#4488ff" />
              <line
                x1="12"
                y1="12"
                x2="5"
                y2="18"
                stroke="#44ff44"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <polygon points="3.5,19.5 6.5,19 5,16.5" fill="#44ff44" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Toolbar;
