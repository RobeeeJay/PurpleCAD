import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A toolbar button that opens a dropdown of tool choices, each with an icon and
// label — the shared pattern behind the Create-primitive / Sweep / Boolean /
// Repeat menus.  `trigger` is the always-visible icon element; `items` is
// [{ key, label, icon, onClick, disabled, active }].  `triggerActive` lights
// the button when the underlying tool is engaged.
const ToolbarDropdown = ({ trigger, title, triggerActive = false, items }) => {
  const btnRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);

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
    const onKeyDown = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        className={`toolbar-btn ${open || triggerActive ? "active" : ""}`}
        title={title}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            className="toolbar-dropdown-menu"
            ref={menuRef}
            style={{ top: pos.top, left: pos.left }}
          >
            {items.map((it) => (
              <button
                key={it.key}
                className={`toolbar-dropdown-item ${it.active ? "active" : ""}`}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                <span className="toolbar-dropdown-icon">{it.icon}</span>
                {it.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
};

export default ToolbarDropdown;
