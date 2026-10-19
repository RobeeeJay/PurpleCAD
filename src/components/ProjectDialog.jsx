import { useEffect } from "react";
import { useStore } from "../store";
import { dedupProjectedShapes } from "../three/sketchProjection.js";
import "../styles/VariablesDialog.css";

// Confirmation for the sketch Project tool.  While open, clicking/dragging in
// the 3D view accumulates projected edges (with a live teal preview); this
// dialog commits them to the sketch or discards them.
const ProjectDialog = () => {
  const projectTool = useStore((s) => s.projectTool);
  const cancelProjectTool = useStore((s) => s.cancelProjectTool);
  const setActiveSketchTool = useStore((s) => s.setActiveSketchTool);
  const addSketchShapes = useStore((s) => s.addSketchShapes);
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);

  const finish = () => {
    const cc = useStore.getState()._cameraControls;
    cc?.clearProjectionPreview?.();
    cc?.clearProjectHover?.();
    cancelProjectTool();
    setActiveSketchTool(null);
  };

  // Leaving the sketch (selecting a non-sketch item) ends the staged projection.
  const onSketch =
    !!projectTool && items.find((i) => i.id === selectedId)?.type === "sketch";
  useEffect(() => {
    if (projectTool && !onSketch) finish();
  }, [projectTool, onSketch]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!projectTool) return null;
  const count = projectTool.shapes.length;
  const confirm = () => {
    const shapes = dedupProjectedShapes(projectTool.shapes);
    if (shapes.length) addSketchShapes(selectedId, shapes);
    finish();
  };

  return (
    <div
      className="variables-dialog-backdrop"
      style={{
        background: "transparent",
        alignItems: "flex-end",
        paddingBottom: 72,
        pointerEvents: "none",
      }}
    >
      <div
        className="variables-dialog"
        style={{ minWidth: 300, pointerEvents: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="variables-dialog-header">
          <h2>Project geometry</h2>
          <button
            className="variables-dialog-close"
            onClick={finish}
            title="Cancel"
          >
            ×
          </button>
        </div>
        <div
          style={{ padding: 16, fontSize: 12, color: "var(--text-secondary)" }}
        >
          Hover over a projected edge (it and the edges joined to it highlight),
          then click it — or drag a box — to add them. Confirm to add them to
          the sketch.
          <div style={{ marginTop: 8, color: "var(--text-primary)" }}>
            {count === 0
              ? "Nothing selected yet."
              : `${count} edge${count === 1 ? "" : "s"} staged.`}
          </div>
        </div>
        <div className="variables-dialog-footer">
          <div />
          <div className="variables-dialog-actions">
            <button className="variables-btn" onClick={finish}>
              Cancel
            </button>
            <button
              className="variables-btn primary"
              disabled={count === 0}
              onClick={confirm}
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectDialog;
