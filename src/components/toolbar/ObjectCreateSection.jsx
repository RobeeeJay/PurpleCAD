import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import SweepSection from "./SweepSection";
import Pattern3dSection from "./Pattern3dSection";
import {
  CubeIcon,
  SphereIcon,
  CylinderIcon,
  ConeIcon,
  TorusIcon,
} from "./timelineIcons.jsx";
import SvgIcon from "../icons/SvgIcon.jsx";

const PRIMITIVES = [
  { type: "cube", label: "Box", Icon: CubeIcon },
  { type: "sphere", label: "Sphere", Icon: SphereIcon },
  { type: "cylinder", label: "Cylinder", Icon: CylinderIcon },
  { type: "cone", label: "Cone", Icon: ConeIcon },
  { type: "torus", label: "Torus", Icon: TorusIcon },
];

const ObjectCreateSection = () => {
  const setSketchPlacementMode = useStore((s) => s.setSketchPlacementMode);
  const extrudeSelectMode = useStore((s) => s.extrudeSelectMode);
  const setExtrudeSelectMode = useStore((s) => s.setExtrudeSelectMode);
  const selectedSubGeometry = useStore((s) => s.selectedSubGeometry);
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const startPlaneTool = useStore((s) => s.startPlaneTool);

  const hasFaceSelected = (selectedSubGeometry?.faces?.length ?? 0) > 0;

  // Primitive-create dropdown (Box / Sphere / Cylinder / Cone / Torus).
  const primBtnRef = useRef(null);
  const primMenuRef = useRef(null);
  const [primMenuOpen, setPrimMenuOpen] = useState(false);
  const [primMenuPos, setPrimMenuPos] = useState(null);
  useEffect(() => {
    if (!primMenuOpen) return;
    const rect = primBtnRef.current?.getBoundingClientRect();
    if (rect) setPrimMenuPos({ top: rect.bottom + 4, left: rect.left });
    const onPointerDown = (e) => {
      if (
        !primMenuRef.current?.contains(e.target) &&
        !primBtnRef.current?.contains(e.target)
      )
        setPrimMenuOpen(false);
    };
    const onKeyDown = (e) => e.key === "Escape" && setPrimMenuOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [primMenuOpen]);

  // Open the Plane dialog seeded from the selected sketch's plane, else world
  // XY.  The dialog also offers axis-plane bases and "Pick 3 points".
  const handlePlane = () => {
    const sel = items.find((i) => i.id === selectedId);
    startPlaneTool(
      sel?.type === "sketch"
        ? { position: { ...sel.position }, rotation: { ...sel.rotation } }
        : { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 } },
    );
  };

  const handleExtrudeClick = () => {
    if (extrudeSelectMode) {
      // Toggling the tool off mid-extrude must also clear the live preview +
      // selection, not just the mode flag.
      const cc = useStore.getState()._cameraControls;
      if (cc?.cancelExtrude) cc.cancelExtrude();
      else setExtrudeSelectMode(null);
      return;
    }
    // A selected solid face extrudes directly along its normal — no need to
    // re-pick it in profile-select mode.
    if (hasFaceSelected) {
      const started = useStore
        .getState()
        ._cameraControls?.extrudeSelectedFace?.();
      if (started) return;
    }
    setExtrudeSelectMode("profile");
  };

  // Every Create button here makes a parametric primitive: open its dimensions
  // dialog with a live ghost preview at the view centre; nothing is added to the
  // timeline until the user confirms.
  const createItem = (type) => {
    const t = useStore.getState()._cameraControls?.getViewTarget?.();
    const position = t ? { x: t.x, y: t.y, z: t.z } : { x: 0, y: 2, z: 0 };
    useStore.getState().openBoxCreate(type, position);
  };

  return (
    <ToolbarSection label="Create">
      <button
        className="toolbar-btn"
        title="Sketch Plane"
        onClick={() => setSketchPlacementMode(true)}
      >
        <SvgIcon name="sketch-plane" size={20} />
      </button>
      <button
        ref={primBtnRef}
        className={`toolbar-btn ${primMenuOpen ? "active" : ""}`}
        title="Create a primitive — Box / Sphere / Cylinder / Cone / Torus"
        onClick={() => setPrimMenuOpen((o) => !o)}
      >
        <SvgIcon name="sphere" size={20} />
      </button>
      {primMenuOpen &&
        primMenuPos &&
        createPortal(
          <div
            className="toolbar-dropdown-menu"
            ref={primMenuRef}
            style={{ top: primMenuPos.top, left: primMenuPos.left }}
          >
            {PRIMITIVES.map((p) => (
              <button
                key={p.type}
                className="toolbar-dropdown-item"
                title={`Add a ${p.label.toLowerCase()} to the scene`}
                onClick={() => {
                  setPrimMenuOpen(false);
                  createItem(p.type);
                }}
              >
                <span className="toolbar-dropdown-icon">
                  <p.Icon />
                </span>
                {p.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
      <button
        className={`toolbar-btn ${extrudeSelectMode ? "active" : ""}`}
        title={
          hasFaceSelected
            ? "Extrude the selected face along its normal"
            : "Extrude — click an enclosed sketch region or flat face"
        }
        onClick={handleExtrudeClick}
      >
        <SvgIcon name="prism" size={20} />
      </button>
      <button
        className="toolbar-btn"
        title="Plane — a reference plane to sketch on (from the selected sketch, else pick 3 points)"
        onClick={handlePlane}
      >
        <SvgIcon name="plane" size={20} />
      </button>
      {/* Sketch→solid sweeps (Revolve / Pipe / Loft) live here in Create. */}
      <SweepSection bare />
      {/* 3D Mirror / Circular / Rectangular patterns also create new objects. */}
      <Pattern3dSection bare />
    </ToolbarSection>
  );
};

export default ObjectCreateSection;
