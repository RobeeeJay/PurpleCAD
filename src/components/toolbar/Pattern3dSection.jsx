import { useStore } from "../../store";
import ToolbarSection from "./ToolbarSection";
import ToolbarDropdown from "./ToolbarDropdown";
import SvgIcon from "../icons/SvgIcon.jsx";

const SOLID_TYPES = [
  "cube",
  "sphere",
  "cylinder",
  "torus",
  "cone",
  "extrude",
  "csg",
];

const MirrorIcon = () => <SvgIcon name="mirror-3d" size={20} />;

const CircularIcon = () => <SvgIcon name="pattern-circular-3d" size={20} />;

const RectangularIcon = () => (
  <SvgIcon name="pattern-rectangular-3d" size={20} />
);

// 3D Repeat tools: Mirror / Circular / Rectangular — collapsed into one
// "Repeat" dropdown triggered by the Circular icon.  The clones are
// regenerator items that rebuild from the live source, so they track the
// original and can't be edited on their own.
const Pattern3dSection = ({ bare = false }) => {
  const selectedIds = useStore((s) => s.selectedIds);
  const items = useStore((s) => s.items);
  const startPattern3d = useStore((s) => s.startPattern3d);
  const startMirror3d = useStore((s) => s.startMirror3d);

  const sel = selectedIds
    .map((id) => items.find((i) => i.id === id))
    .filter(Boolean);
  const source = sel.find((i) => SOLID_TYPES.includes(i.type));

  // No selection required — the dialog's "Object" button picks the source (and
  // auto-enters object-pick mode when opened with nothing selected).  Seed it
  // from the current selection when there is one.
  const handleCircular = () =>
    startPattern3d({ patternType: "circular", sourceId: source?.id });
  const handleRectangular = () =>
    startPattern3d({ patternType: "rectangular", sourceId: source?.id });

  // Open the Mirror dialog (seeded from the current selection); it owns the
  // object/plane picking and the confirm.
  const handleMirror = () => startMirror3d();

  const body = (
    <ToolbarDropdown
      trigger={<CircularIcon />}
      title="Repeat — Mirror / Circular / Rectangular"
      items={[
        {
          key: "mirror",
          label: "Mirror",
          title: "Mirror — reflect the selected body across a picked plane",
          icon: <MirrorIcon />,
          onClick: handleMirror,
        },
        {
          key: "circular",
          label: "Circular",
          title: "Circular pattern — repeat the body around a picked axis",
          icon: <CircularIcon />,
          onClick: handleCircular,
        },
        {
          key: "rectangular",
          label: "Rectangular",
          title: "Rectangular pattern — repeat the body on an X/Y/Z grid",
          icon: <RectangularIcon />,
          onClick: handleRectangular,
        },
      ]}
    />
  );

  return bare ? body : <ToolbarSection label="Modify">{body}</ToolbarSection>;
};

export default Pattern3dSection;
