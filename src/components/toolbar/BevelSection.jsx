import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import { canSimplify } from "../../three/cameraControls/simplify.js";
import { canConvert } from "../../three/cameraControls/convertSurfaces.js";
import SvgIcon from "../icons/SvgIcon.jsx";

const BevelSection = ({ bare = false }) => {
  const clearSelectedSubGeometry = useStore((s) => s.clearSelectedSubGeometry);
  const chamferSelectMode = useStore((s) => s.chamferSelectMode);
  const setChamferSelectMode = useStore((s) => s.setChamferSelectMode);
  const pushPullSelectMode = useStore((s) => s.pushPullSelectMode);
  const setPushPullSelectMode = useStore((s) => s.setPushPullSelectMode);
  const selectedId = useStore((s) => s.selectedId);
  const items = useStore((s) => s.items);
  const setShellTarget = useStore((s) => s.setShellTarget);
  const setSimplifyTarget = useStore((s) => s.setSimplifyTarget);
  const setConvertTarget = useStore((s) => s.setConvertTarget);
  const holeTool = useStore((s) => s.holeTool);
  const startHoleTool = useStore((s) => s.startHoleTool);
  const cancelHoleTool = useStore((s) => s.cancelHoleTool);
  const embossTool = useStore((s) => s.embossTool);
  const startEmbossTool = useStore((s) => s.startEmbossTool);
  const cancelEmbossTool = useStore((s) => s.cancelEmbossTool);
  const draftTool = useStore((s) => s.draftTool);
  const startDraftTool = useStore((s) => s.startDraftTool);
  const cancelDraftTool = useStore((s) => s.cancelDraftTool);

  // Shell hollows the whole selected body, so it only needs a solid selected
  // (no face/edge pick).  Sketches and the empty selection are ineligible.
  const selectedBody = items.find((i) => i.id === selectedId);
  const canShell = !!selectedBody && selectedBody.type !== "sketch";
  // Draft guides its own picks (main face → faces to taper), so — like Hole /
  // Emboss — it needs no pre-selection; the body comes from the main-face pick.
  const toggleDraft = () => {
    if (draftTool) cancelDraftTool();
    else startDraftTool();
  };
  const openShell = () => {
    if (canShell) setShellTarget({ itemId: selectedId });
  };
  // Simplify works on a body's mesh, so only a mesh body qualifies.
  const openSimplify = () => {
    if (canSimplify(selectedBody)) setSimplifyTarget({ itemId: selectedId });
  };
  // Convert works on a body's mesh too, and only one that isn't exact already.
  const openConvert = () => {
    if (canConvert(selectedBody)) setConvertTarget({ itemId: selectedId });
  };
  // Hole guides its own face + point pick, so it needs no pre-selection.
  const toggleHole = () => {
    if (holeTool) cancelHoleTool();
    else startHoleTool();
  };
  // Emboss guides its own geometry + face picks from its dialog.
  const toggleEmboss = () => {
    if (embossTool) cancelEmbossTool();
    else startEmbossTool();
  };

  const toggleMode = (mode) => {
    if (chamferSelectMode === mode) {
      setChamferSelectMode(null);
      clearSelectedSubGeometry();
    } else {
      setChamferSelectMode(mode);
    }
  };

  // Push/Pull shares the face-selection UX with chamfer/fillet; its store
  // setter clears chamferSelectMode so only one pick/confirm overlay is live.
  const togglePushPull = () => {
    if (pushPullSelectMode) {
      setPushPullSelectMode(null);
      clearSelectedSubGeometry();
    } else {
      setPushPullSelectMode("pushpull");
    }
  };

  const body = (
    <>
      <button
        className={`toolbar-btn ${chamferSelectMode === "chamfer" ? "active" : ""}`}
        title="Chamfer — select faces/edges, then confirm a distance"
        onClick={() => toggleMode("chamfer")}
      >
        <SvgIcon name="chamfer" size={20} />
      </button>
      <button
        className={`toolbar-btn ${chamferSelectMode === "fillet" ? "active" : ""}`}
        title="Bevel — select faces/edges, then confirm a radius"
        onClick={() => toggleMode("fillet")}
      >
        <SvgIcon name="fillet" size={20} />
      </button>
      <button
        className={`toolbar-btn ${pushPullSelectMode ? "active" : ""}`}
        title="Push/Pull — select faces, then confirm a distance to move them along their normal"
        onClick={togglePushPull}
      >
        <SvgIcon name="push-pull" size={20} />
      </button>
      <button
        className="toolbar-btn"
        title="Shell — hollow the selected body to a wall thickness"
        disabled={!canShell}
        onClick={openShell}
      >
        <SvgIcon name="shell" size={20} />
      </button>
      <button
        className="toolbar-btn"
        title={
          canSimplify(selectedBody)
            ? "Simplify — fewer triangles for the selected mesh body, within a deviation or to a count"
            : "Simplify — select a mesh body (an import, a split piece, or a modelled body) first"
        }
        disabled={!canSimplify(selectedBody)}
        onClick={openSimplify}
      >
        <SvgIcon name="simplify" size={20} />
      </button>
      <button
        className="toolbar-btn"
        title={
          canConvert(selectedBody)
            ? "Convert to Surfaces — rebuild the selected mesh body as exact planes, cylinders, cones, spheres, tori and oval walls"
            : "Convert to Surfaces — select a mesh body (an import or a simplified mesh) first"
        }
        disabled={!canConvert(selectedBody)}
        onClick={openConvert}
      >
        <SvgIcon name="convert-surfaces" size={20} />
      </button>
      <button
        className={`toolbar-btn ${holeTool ? "active" : ""}`}
        title="Hole — pick a face then a point, then cut a (optionally threaded) hole"
        onClick={toggleHole}
      >
        <SvgIcon name="hole" size={20} />
      </button>
      <button
        className={`toolbar-btn ${embossTool ? "active" : ""}`}
        title="Emboss — stamp sketch geometry onto a face as a raised or recessed relief"
        onClick={toggleEmboss}
      >
        <SvgIcon name="emboss-deboss" size={20} />
      </button>
      <button
        className={`toolbar-btn ${draftTool ? "active" : ""}`}
        title="Draft — taper faces about a neutral (main) face for moulding/casting"
        onClick={toggleDraft}
      >
        <SvgIcon name="draft" size={20} />
      </button>
    </>
  );
  return bare ? body : <ToolbarSection label="Modify">{body}</ToolbarSection>;
};

export default BevelSection;
