// The long-press context menu shown in sketch mode: a list of the points,
// lines, and constraints under the cursor.  Hovering an entry highlights the
// corresponding element; clicking selects it.  Driven by the store's
// sketchLongPressMenu state and the highlight/select hooks on cameraControlsRef.

import { useStore } from "../../store";

const KIND_COLORS = {
  point: "#aabbff",
  line: "#88aaff",
};

export default function SketchLongPressMenu({ cameraControlsRef }) {
  const menu = useStore((state) => state.sketchLongPressMenu);
  if (!menu) return null;

  const { x, y, items } = menu;

  const constraintHex = (color) =>
    `#${(color ?? 0xffaa00).toString(16).padStart(6, "0")}`;

  return (
    <div
      className="sketch-long-press-menu"
      style={{ left: x + 10, top: y + 10 }}
      onMouseLeave={() => cameraControlsRef.current?.clearMenuHighlight?.()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {items.map((item, i) => (
        <div
          key={i}
          className="sketch-long-press-menu-item"
          onMouseEnter={() =>
            cameraControlsRef.current?.highlightForMenu?.(item)
          }
          onClick={(e) => {
            e.stopPropagation();
            cameraControlsRef.current?.clearMenuHighlight?.();
            cameraControlsRef.current?.selectMenuItem?.(item);
            useStore.getState().setSketchLongPressMenu(null);
          }}
        >
          <span
            className="sketch-long-press-menu-dot"
            style={{
              background:
                item.kind === "constraint"
                  ? constraintHex(item.constraintColor)
                  : (KIND_COLORS[item.kind] ?? "#aaa"),
            }}
          />
          {item.label}
        </div>
      ))}
    </div>
  );
}
