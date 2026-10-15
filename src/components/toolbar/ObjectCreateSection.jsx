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
        <svg viewBox="0 0 24 24" width="20" height="20">
          <polygon
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinejoin="miter"
            points="2,19 8,13 22,13 16,19"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="2"
            y1="19"
            x2="22"
            y2="13"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1"
            strokeDasharray="2 2"
            x1="8"
            y1="13"
            x2="16"
            y2="19"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            x1="12"
            y1="16"
            x2="12"
            y2="8"
          />
          <polygon
            fill="#6C3FD4"
            stroke="#6C3FD4"
            strokeWidth="0.5"
            points="12,5 10.5,8.5 13.5,8.5"
          />
          <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="12" cy="16" />
        </svg>
      </button>
      <button
        ref={primBtnRef}
        className={`toolbar-btn ${primMenuOpen ? "active" : ""}`}
        title="Create a primitive — Box / Sphere / Cylinder / Cone / Torus"
        onClick={() => setPrimMenuOpen((o) => !o)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <circle
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            cx="12"
            cy="12"
            r="9"
          />
          <ellipse
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2"
            cx="12"
            cy="12"
            rx="9"
            ry="3.5"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 1.5"
            x1="3"
            y1="12"
            x2="21"
            y2="12"
          />
        </svg>
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
        <svg viewBox="0 0 24 24" width="20" height="20">
          <polygon
            stroke="#c4c2b8"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            points="12,3 21,8 21,16 12,21 3,16 3,8"
          />
          <line
            stroke="#6C3FD4"
            fill="none"
            strokeWidth="2"
            strokeLinecap="square"
            x1="3"
            y1="8"
            x2="21"
            y2="8"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 1.5"
            x1="3"
            y1="16"
            x2="21"
            y2="16"
          />
          <line
            stroke="#D4A33F"
            fill="none"
            strokeWidth="1.5"
            strokeDasharray="2 1.5"
            x1="12"
            y1="3"
            x2="12"
            y2="21"
          />
        </svg>
      </button>
      <button
        className="toolbar-btn"
        title="Plane — a reference plane to sketch on (from the selected sketch, else pick 3 points)"
        onClick={handlePlane}
      >
        <svg viewBox="0 0 24 24" width="20" height="20">
          <polygon
            points="3,9 14,5 21,11 10,15"
            fill="rgba(68,136,255,0.25)"
            stroke="#4488ff"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <line
            x1="12"
            y1="10"
            x2="12"
            y2="20"
            stroke="#D4A33F"
            strokeWidth="1.5"
            strokeDasharray="2 2"
          />
        </svg>
      </button>
      {/* Sketch→solid sweeps (Revolve / Pipe / Loft) live here in Create. */}
      <SweepSection bare />
      {/* 3D Mirror / Circular / Rectangular patterns also create new objects. */}
      <Pattern3dSection bare />
    </ToolbarSection>
  );
};

export default ObjectCreateSection;
