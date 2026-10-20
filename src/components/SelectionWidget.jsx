import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store";
import { effectiveSelectionTypes } from "../store/selectionMode.js";
import VisibilityToggles, { useShiftHeld } from "./VisibilityToggles";
import { NumberInput } from "./inputs.jsx";
import SvgIcon from "./icons/SvgIcon.jsx";

// The selection widget: four toggle icons at the top-left of the 3D view (clear
// of the Objects/Timeline panel) choosing what a click selects — whole Object,
// or Face / Edge / Point.  Object mode greys the sub-types; a running tool locks
// the set (e.g. extrude → face only).  Hover priority is point > edge > face.
// Holding Shift swaps the widget for the Show-Constraints / Show-Dimensions
// visibility toggles.

const ObjectIcon = () => <SvgIcon name="select-object" size={18} />;
const FaceIcon = () => <SvgIcon name="select-face" size={18} />;
const EdgeIcon = () => <SvgIcon name="select-edge" size={18} />;
const PointIcon = () => <SvgIcon name="select-point" size={18} />;
// Two interlocking links — chain the selection along a curve / smooth edge run.
const ChainIcon = () => <SvgIcon name="select-chain" size={18} />;
const SelectionWidget = () => {
  const sketchMode = useStore((s) => {
    const it = s.items.find((i) => i.id === s.selectedId);
    return it?.type === "sketch";
  });
  const selObject = useStore((s) => s.selObject);
  // Derived from the WHOLE store, not a hand-kept list of the fields the tool
  // locks read.  That list fell behind the locks: it had no splitPick, so the
  // Split tool's cut phase kept showing Object while hover picked faces, and no
  // emboss / draft / point-to-point state, so their locks never showed at all.
  const eff = useStore(useShallow(effectiveSelectionTypes));
  const selChain = useStore((s) => s.selChain);
  const curveDetectionAngleDeg = useStore((s) => s.curveDetectionAngleDeg);
  const setCurveDetectionAngleDeg = useStore(
    (s) => s.setCurveDetectionAngleDeg,
  );
  const toggleSelObject = useStore((s) => s.toggleSelObject);
  const toggleSelFace = useStore((s) => s.toggleSelFace);
  const toggleSelEdge = useStore((s) => s.toggleSelEdge);
  const toggleSelPoint = useStore((s) => s.toggleSelPoint);
  const toggleSelChain = useStore((s) => s.toggleSelChain);
  const soloSelType = useStore((s) => s.soloSelType);
  const shiftHeld = useShiftHeld();

  // Hidden in sketch mode — it only governs 3D-view selection (the sketch
  // widget shows there instead).
  if (sketchMode) return null;
  // While Shift is held, swap for the constraint/dimension visibility toggles.
  if (shiftHeld) return <VisibilityToggles className="selection-widget" />;

  const locked = eff.overridden; // a tool controls the set
  const btns = [
    {
      key: "object",
      Icon: ObjectIcon,
      on: eff.object,
      toggle: toggleSelObject,
      title: "Select objects",
    },
    {
      key: "face",
      Icon: FaceIcon,
      on: eff.face,
      toggle: toggleSelFace,
      title: "Select faces",
    },
    {
      key: "edge",
      Icon: EdgeIcon,
      on: eff.edge,
      toggle: toggleSelEdge,
      title: "Select edges",
    },
    {
      key: "point",
      Icon: PointIcon,
      on: eff.point,
      toggle: toggleSelPoint,
      title: "Select points (vertices)",
    },
  ];

  // Chaining only applies to face/edge picks, so it's actionable only when one
  // of those is on; the flag is remembered while greyed out (see toggleSelChain).
  const chainEnabled = !locked && (eff.face || eff.edge);
  const chainOn = selChain && chainEnabled;

  return (
    <div className="selection-widget">
      {btns.map(({ key, Icon, on, toggle, title }) => {
        // Sub-types are greyed while Object mode is on; everything is greyed
        // (locked) while a tool forces a set.
        const greyed = locked ? !on : key !== "object" && selObject;
        return (
          <button
            key={key}
            type="button"
            className={`selection-widget-btn${on ? " active" : ""}${greyed ? " greyed" : ""}`}
            title={
              locked
                ? `${title} — locked by the active tool`
                : `${title} (⌘/Ctrl-click to isolate)`
            }
            disabled={locked}
            onClick={
              locked
                ? undefined
                : (e) => (e.metaKey || e.ctrlKey ? soloSelType(key) : toggle())
            }
          >
            <Icon />
          </button>
        );
      })}
      <button
        type="button"
        className={`selection-widget-btn${chainOn ? " active" : ""}${chainEnabled ? "" : " greyed"}`}
        title={
          chainEnabled
            ? "Chain selection (B) — follow a face/edge across the curve angle limit"
            : "Chain selection (B) — enable Face or Edge selection to use"
        }
        disabled={!chainEnabled}
        onClick={chainEnabled ? () => toggleSelChain() : undefined}
      >
        <ChainIcon />
      </button>
      {chainOn && (
        <label
          className="selection-widget-angle"
          title="Largest bend between neighbouring faces/edges still followed as one surface. Raise it to carry a selection round a tighter curve; lower it to stop at a crease."
        >
          <NumberInput
            value={curveDetectionAngleDeg}
            onCommit={(n) => setCurveDetectionAngleDeg(n)}
            min="0"
            max="90"
            step="1"
            aria-label="Chain angle limit (degrees)"
          />
          <span>°</span>
        </label>
      )}
    </div>
  );
};

export default SelectionWidget;
