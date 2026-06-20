// Small (14x14, currentColor) versions of the Create / Combine / Bevel /
// Modify toolbar icons, reused by the Timeline so each entry's dot matches
// the toolbar button that produced it.

export const CubeIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <polyline
      points="3,7 7,3 21,3 21,17 17,21 3,21 3,7 17,7 17,21"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
    />
    <line
      x1="3"
      y1="7"
      x2="17"
      y2="7"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
    />
    <line
      x1="21"
      y1="3"
      x2="7"
      y2="17"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="2 1.5"
    />
  </svg>
);

export const SphereIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <circle
      cx="12"
      cy="12"
      r="9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <ellipse
      cx="12"
      cy="12"
      rx="9"
      ry="3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

export const CylinderIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <ellipse
      cx="12"
      cy="7"
      rx="8"
      ry="3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <ellipse
      cx="12"
      cy="17"
      rx="8"
      ry="3"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <line
      x1="4"
      y1="7"
      x2="4"
      y2="17"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
    />
    <line
      x1="20"
      y1="7"
      x2="20"
      y2="17"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
    />
  </svg>
);

export const TorusIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <circle
      cx="12"
      cy="12"
      r="9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <circle
      cx="12"
      cy="12"
      r="4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

export const SketchPlaneIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <polygon
      points="2,19 8,13 22,13 16,19"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="miter"
    />
    <line
      x1="12"
      y1="16"
      x2="12"
      y2="8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
    />
    <polygon points="12,5 10.5,8.5 13.5,8.5" fill="currentColor" />
  </svg>
);

export const ExtrudeIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <polygon
      points="12,3 21,8 21,16 12,21 3,16 3,8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
    />
    <line
      x1="3"
      y1="8"
      x2="21"
      y2="8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
    />
    <line
      x1="12"
      y1="3"
      x2="12"
      y2="21"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="2 1.5"
    />
  </svg>
);

export const UnionIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <rect
      x="3"
      y="3"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="2 1.5"
    />
    <rect
      x="9"
      y="9"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="2 1.5"
    />
    <path
      d="M3 9 L9 9 L9 3 L15 3 L15 9 L21 9 L21 21 L9 21 L9 15 L3 15 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
    />
  </svg>
);

export const DifferenceIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <rect
      x="3"
      y="3"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <rect
      x="9"
      y="9"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="2 1.5"
    />
    <rect
      x="3"
      y="3"
      width="6"
      height="6"
      fill="currentColor"
      fillOpacity="0.25"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
    />
    <rect
      x="9"
      y="3"
      width="6"
      height="6"
      fill="currentColor"
      fillOpacity="0.25"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
    />
    <rect
      x="3"
      y="9"
      width="6"
      height="6"
      fill="currentColor"
      fillOpacity="0.25"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
    />
  </svg>
);

export const IntersectionIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <rect
      x="3"
      y="3"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="2 1.5"
    />
    <rect
      x="9"
      y="9"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="2 1.5"
    />
    <rect
      x="9"
      y="9"
      width="6"
      height="6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
    />
  </svg>
);

export const SplitIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <circle
      cx="6"
      cy="12"
      r="4.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <rect
      x="14"
      y="9"
      width="7"
      height="7"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="miter"
    />
    <line
      x1="12"
      y1="4"
      x2="12"
      y2="20"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="2 2"
      strokeLinecap="square"
    />
  </svg>
);

export const ChamferIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <line
      x1="4"
      y1="20"
      x2="4"
      y2="8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
    />
    <line
      x1="4"
      y1="8"
      x2="16"
      y2="8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
    />
    <polyline
      points="4,20 4,13 9,8 16,8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
      strokeLinejoin="miter"
    />
  </svg>
);

export const ShellIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <polygon
      points="4,8 12,4 20,8 12,12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="miter"
    />
    <line
      x1="4"
      y1="8"
      x2="4"
      y2="16"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <line
      x1="20"
      y1="8"
      x2="20"
      y2="16"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <polyline
      points="4,16 12,20 20,16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="miter"
    />
    <polygon
      points="7,8.5 12,6 17,8.5 12,11"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="miter"
      opacity="0.6"
    />
  </svg>
);

export const HoleIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <rect
      x="3"
      y="6"
      width="18"
      height="12"
      rx="1"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <circle
      cx="12"
      cy="12"
      r="3.6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <line
      x1="8.6"
      y1="10.4"
      x2="15.4"
      y2="10.4"
      stroke="currentColor"
      strokeWidth="1"
      opacity="0.7"
    />
    <line
      x1="8.6"
      y1="13.6"
      x2="15.4"
      y2="13.6"
      stroke="currentColor"
      strokeWidth="1"
      opacity="0.7"
    />
  </svg>
);

export const FilletIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <line
      x1="4"
      y1="20"
      x2="4"
      y2="8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
    />
    <line
      x1="4"
      y1="8"
      x2="16"
      y2="8"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
    />
    <path
      d="M4 20 L4 14 Q4 8 10 8 L16 8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="square"
    />
  </svg>
);

export const PlaneIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <polygon
      points="3,12 13,6 21,12 11,18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <line
      x1="12"
      y1="12"
      x2="12"
      y2="21"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="2 2"
    />
  </svg>
);

export const RevolveIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <line
      x1="5"
      y1="2"
      x2="5"
      y2="22"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="2 2"
    />
    <rect
      x="9"
      y="8"
      width="4"
      height="8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M9 8 C 17 8, 21 10, 21 12 C 21 14, 17 16, 13 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

export const PipeIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <path
      d="M4 20 L4 9 C4 6, 6 4, 9 4 L20 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="2 2"
      strokeLinecap="round"
    />
    <rect
      x="1.5"
      y="17"
      width="5"
      height="5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

export const LoftIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <rect
      x="9"
      y="3"
      width="6"
      height="4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <rect
      x="4"
      y="17"
      width="16"
      height="4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <line
      x1="9"
      y1="7"
      x2="4"
      y2="17"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <line
      x1="15"
      y1="7"
      x2="20"
      y2="17"
      stroke="currentColor"
      strokeWidth="1.5"
    />
  </svg>
);

export const MirrorIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <line
      x1="12"
      y1="2"
      x2="12"
      y2="22"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="2 2"
    />
    <polygon
      points="4,7 10,5 10,17 4,19"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <polygon
      points="20,7 14,5 14,17 20,19"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

export const CircularPatternIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <circle
      cx="12"
      cy="12"
      r="8"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeDasharray="2 2"
    />
    <rect x="10.5" y="2.5" width="3" height="3" fill="currentColor" />
    <rect x="18.5" y="10.5" width="3" height="3" fill="currentColor" />
    <rect x="10.5" y="18.5" width="3" height="3" fill="currentColor" />
    <rect x="2.5" y="10.5" width="3" height="3" fill="currentColor" />
  </svg>
);

export const RectangularPatternIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14">
    <rect x="3" y="3" width="4" height="4" fill="currentColor" />
    <rect x="10" y="3" width="4" height="4" fill="currentColor" />
    <rect x="17" y="3" width="4" height="4" fill="currentColor" />
    <rect x="3" y="10" width="4" height="4" fill="currentColor" />
    <rect x="10" y="10" width="4" height="4" fill="currentColor" />
    <rect x="17" y="10" width="4" height="4" fill="currentColor" />
    <rect x="3" y="17" width="4" height="4" fill="currentColor" />
    <rect x="10" y="17" width="4" height="4" fill="currentColor" />
    <rect x="17" y="17" width="4" height="4" fill="currentColor" />
  </svg>
);
