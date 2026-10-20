import SvgIcon from "../icons/SvgIcon.jsx";
// Small (14x14, currentColor) versions of the Create / Combine / Bevel /
// Modify toolbar icons, reused by the Timeline so each entry's dot matches
// the toolbar button that produced it.

// Standard edit (pencil) icon used by every Timeline entry's Edit button.
export const EditIcon = () => <SvgIcon name="rename" size={14} />;

export const CubeIcon = () => <SvgIcon name="step-cube" size={14} />;

export const SphereIcon = () => <SvgIcon name="step-sphere" size={14} />;

export const CylinderIcon = () => <SvgIcon name="step-cylinder" size={14} />;

export const TorusIcon = () => <SvgIcon name="step-torus" size={14} />;

export const ConeIcon = () => <SvgIcon name="step-cone" size={14} />;

export const SketchPlaneIcon = () => (
  <SvgIcon name="step-sketch-plane" size={14} />
);

export const ExtrudeIcon = () => <SvgIcon name="step-extrude" size={14} />;

export const UnionIcon = () => <SvgIcon name="step-union" size={14} />;

export const DifferenceIcon = () => <SvgIcon name="step-subtract" size={14} />;

export const IntersectionIcon = () => (
  <SvgIcon name="step-intersect" size={14} />
);

export const SplitIcon = () => <SvgIcon name="step-split" size={14} />;

export const ChamferIcon = () => <SvgIcon name="step-chamfer" size={14} />;

// A triangle whose left half is finely meshed and right half is one facet:
// the same surface in fewer triangles.
export const SimplifyIcon = () => <SvgIcon name="step-simplify" size={14} />;

export const ShellIcon = () => <SvgIcon name="step-shell" size={14} />;

export const TextureIcon = () => <SvgIcon name="step-texture" size={14} />;

export const EmbossIcon = () => <SvgIcon name="step-emboss" size={14} />;

export const HoleIcon = () => <SvgIcon name="step-hole" size={14} />;

export const FilletIcon = () => <SvgIcon name="step-fillet" size={14} />;

export const PlaneIcon = () => <SvgIcon name="step-plane" size={14} />;

export const RevolveIcon = () => <SvgIcon name="step-revolve" size={14} />;

export const PipeIcon = () => <SvgIcon name="step-pipe" size={14} />;

export const LoftIcon = () => <SvgIcon name="step-loft" size={14} />;

export const MirrorIcon = () => <SvgIcon name="step-mirror" size={14} />;

export const CircularPatternIcon = () => (
  <SvgIcon name="step-pattern-circular" size={14} />
);

export const RectangularPatternIcon = () => (
  <SvgIcon name="step-pattern-rectangular" size={14} />
);

// A circle whose left half is facets and right half a smooth arc: a mesh
// turned into the curved surface it approximated.
export const ConvertSurfacesIcon = () => (
  <SvgIcon name="step-convert-surfaces" size={14} />
);
