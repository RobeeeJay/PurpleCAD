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
