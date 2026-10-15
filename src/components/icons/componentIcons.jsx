// Icons for components in the Objects list: the component itself (a part), a
// new-component button, and the component's motion controls.  Same palette as
// the rest of the list: grey outlines, the purple accent, the gold highlight.

const Svg = ({ children }) => (
  <svg width="16" height="16" viewBox="0 0 24 24">
    {children}
  </svg>
);

// A machined part: an isometric block with a bore through its top.
const PartShape = () => (
  <>
    <polygon
      points="12,3 21,7.5 21,16.5 12,21 3,16.5 3,7.5"
      stroke="#c4c2b8"
      fill="none"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <polyline
      points="3,7.5 12,12 21,7.5"
      stroke="#c4c2b8"
      fill="none"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <line x1="12" y1="12" x2="12" y2="21" stroke="#c4c2b8" strokeWidth="1.5" />
    <ellipse
      cx="12"
      cy="7.6"
      rx="3"
      ry="1.5"
      stroke="#6C3FD4"
      fill="none"
      strokeWidth="1.5"
    />
  </>
);

export const ComponentIcon = () => (
  <Svg>
    <PartShape />
  </Svg>
);

export const NewComponentIcon = () => (
  <Svg>
    <PartShape />
    <line x1="19" y1="1" x2="19" y2="7" stroke="#D4A33F" strokeWidth="2" />
    <line x1="16" y1="4" x2="22" y2="4" stroke="#D4A33F" strokeWidth="2" />
  </Svg>
);

// Motion settings: a curved arrow round a pivot point.
export const MotionIcon = () => (
  <Svg>
    <path
      d="M5 15 A8 8 0 1 1 15 19.5"
      stroke="currentColor"
      fill="none"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
    <polyline
      points="11,19.5 15,19.5 14,15.5"
      stroke="currentColor"
      fill="none"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <circle cx="12" cy="12" r="2" fill="#D4A33F" />
  </Svg>
);

export const PlayIcon = () => (
  <Svg>
    <polygon points="7,4 20,12 7,20" fill="currentColor" />
  </Svg>
);

export const PauseIcon = () => (
  <Svg>
    <rect x="6" y="4" width="4" height="16" fill="currentColor" />
    <rect x="14" y="4" width="4" height="16" fill="currentColor" />
  </Svg>
);
