// The toolbar artwork for each sketch constraint (and the circular pattern
// link), in ONE place: the toolbar buttons render these, and the sketch view
// rasterises the very same components for the markers it draws beside each
// constraint (three/sceneObjects/constraintIconSprites.js), so a marker always
// looks like the button that made it.

import React from "react";
import { cogOutline } from "../../three/cogGeometry.js";

const Art = ({ size, children }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    width={size}
    height={size}
  >
    {children}
  </svg>
);

export const CoincidentArt = ({ size = 20 }) => (
  <Art size={size}>
    <circle
      stroke="#c4c2b8"
      fill="none"
      strokeWidth="1.5"
      cx="8"
      cy="12"
      r="5"
    />
    <circle
      stroke="#c4c2b8"
      fill="none"
      strokeWidth="1.5"
      cx="16"
      cy="12"
      r="5"
    />
    <circle fill="#6C3FD4" stroke="#6C3FD4" r="2" cx="12" cy="12" />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="8"
      y1="12"
      x2="10"
      y2="12"
    />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="14"
      y1="12"
      x2="16"
      y2="12"
    />
  </Art>
);

export const MidpointArt = ({ size = 20 }) => (
  <Art size={size}>
    <line
      stroke="#6C3FD4"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="4"
      y1="17"
      x2="20"
      y2="7"
    />
    <circle cx="12" cy="12" r="2.6" fill="#D4A33F" />
  </Art>
);

export const DistanceArt = ({ size = 20 }) => (
  <Art size={size}>
    <line
      stroke="#c4c2b8"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="4"
      y1="6"
      x2="4"
      y2="19"
    />
    <line
      stroke="#c4c2b8"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="20"
      y1="6"
      x2="20"
      y2="19"
    />
    <line
      stroke="#6C3FD4"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="4"
      y1="12"
      x2="20"
      y2="12"
    />
    <polygon
      fill="#6C3FD4"
      stroke="#6C3FD4"
      strokeWidth="0.5"
      points="4,12 7,10.5 7,13.5"
    />
    <polygon
      fill="#6C3FD4"
      stroke="#6C3FD4"
      strokeWidth="0.5"
      points="20,12 17,10.5 17,13.5"
    />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1"
      strokeDasharray="2 2"
      x1="4"
      y1="6"
      x2="20"
      y2="6"
    />
    <text
      x="10"
      y="20"
      fontSize="7"
      fontFamily="monospace"
      fill="#D4A33F"
      fontWeight="500"
    >
      dim
    </text>
  </Art>
);

export const HorizontalArt = ({ size = 20 }) => (
  <Art size={size}>
    <line
      stroke="#6C3FD4"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="3"
      y1="12"
      x2="21"
      y2="12"
    />
    <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="3" cy="12" />
    <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="21" cy="12" />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="9"
      y1="9"
      x2="9"
      y2="15"
    />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="15"
      y1="9"
      x2="15"
      y2="15"
    />
  </Art>
);

export const VerticalArt = ({ size = 20 }) => (
  <Art size={size}>
    <line
      stroke="#6C3FD4"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="12"
      y1="3"
      x2="12"
      y2="21"
    />
    <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="12" cy="3" />
    <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="12" cy="21" />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="9"
      y1="9"
      x2="15"
      y2="9"
    />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="9"
      y1="15"
      x2="15"
      y2="15"
    />
  </Art>
);

// The horizontal/vertical button at rest, with no line selected to choose
// between them: a level line and an upright one, each with its own tick.
export const HorizontalVerticalArt = ({ size = 20 }) => (
  <Art size={size}>
    <line
      stroke="#6C3FD4"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="5"
      y1="3"
      x2="5"
      y2="19"
    />
    <line
      stroke="#6C3FD4"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="5"
      y1="19"
      x2="21"
      y2="19"
    />
    <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="5" cy="3" />
    <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="5" cy="19" />
    <circle fill="#D4A33F" stroke="#D4A33F" r="1.5" cx="21" cy="19" />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="2"
      y1="11"
      x2="8"
      y2="11"
    />
    <line
      stroke="#D4A33F"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="13"
      y1="16"
      x2="13"
      y2="22"
    />
  </Art>
);

export const ParallelArt = ({ size = 20 }) => (
  <Art size={size}>
    <line
      stroke="#6C3FD4"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="5"
      y1="19"
      x2="13"
      y2="5"
    />
    <line
      stroke="#6C3FD4"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="11"
      y1="19"
      x2="19"
      y2="5"
    />
    <line
      stroke="#D4A33F"
      strokeWidth="1"
      strokeDasharray="2 2"
      x1="8"
      y1="14"
      x2="14"
      y2="14"
    />
  </Art>
);

export const ColinearArt = ({ size = 20 }) => (
  <Art size={size}>
    <line
      stroke="#6C3FD4"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="3"
      y1="12"
      x2="10"
      y2="12"
    />
    <line
      stroke="#6C3FD4"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="14"
      y1="12"
      x2="21"
      y2="12"
    />
    <circle fill="#D4A33F" stroke="#D4A33F" r="1.4" cx="3" cy="12" />
    <circle fill="#D4A33F" stroke="#D4A33F" r="1.4" cx="21" cy="12" />
  </Art>
);

export const TangentArt = ({ size = 20 }) => (
  <Art size={size}>
    <circle
      stroke="#6C3FD4"
      fill="none"
      strokeWidth="1.5"
      cx="9"
      cy="13"
      r="5.5"
    />
    <line
      stroke="#D4A33F"
      strokeWidth="1.5"
      strokeLinecap="square"
      x1="3"
      y1="4.5"
      x2="21"
      y2="11"
    />
  </Art>
);

export const EqualArt = ({ size = 20 }) => (
  <Art size={size}>
    <line
      stroke="#6C3FD4"
      strokeWidth="2"
      strokeLinecap="square"
      x1="5"
      y1="9"
      x2="19"
      y2="9"
    />
    <line
      stroke="#6C3FD4"
      strokeWidth="2"
      strokeLinecap="square"
      x1="5"
      y1="15"
      x2="19"
      y2="15"
    />
  </Art>
);

export const CentreArt = ({ size = 20 }) => (
  <Art size={size}>
    <rect
      x="3"
      y="3"
      width="18"
      height="18"
      rx="1"
      stroke="#c4c2b8"
      strokeWidth="1.5"
      fill="none"
    />
    <circle
      cx="12"
      cy="12"
      r="4.5"
      stroke="#6C3FD4"
      strokeWidth="1.5"
      fill="none"
    />
    <line
      x1="12"
      y1="8.5"
      x2="12"
      y2="15.5"
      stroke="#D4A33F"
      strokeWidth="1.5"
    />
    <line
      x1="8.5"
      y1="12"
      x2="15.5"
      y2="12"
      stroke="#D4A33F"
      strokeWidth="1.5"
    />
  </Art>
);

export const CircularPatternArt = ({ size = 20 }) => (
  <Art size={size}>
    <circle
      cx="12"
      cy="12"
      r="8"
      stroke="#D4A33F"
      strokeDasharray="2 2"
      fill="none"
      strokeWidth="1.5"
    />
    <circle cx="12" cy="12" r="1" fill="#D4A33F" />
    <rect x="10.5" y="2.5" width="3" height="3" fill="#6C3FD4" />
    <rect x="17.5" y="9.5" width="3" height="3" fill="#c4c2b8" />
    <rect x="3.5" y="9.5" width="3" height="3" fill="#c4c2b8" />
  </Art>
);

// The cog icon is drawn by the cog tool's own geometry: an 8-tooth gear whose
// tip circle fills the 24-unit box, flipped to SVG's y-down.
const COG_ICON_PATH = (() => {
  const [outline] = cogOutline({
    pitchDiameter: 16,
    teeth: 8,
    backlash: 0,
    rootFillet: 0.4,
    holeDiameter: 0,
  }).contours;
  return (
    outline
      .map(
        (q, i) =>
          `${i ? "L" : "M"}${(12 + q.x).toFixed(2)} ${(12 - q.y).toFixed(2)}`,
      )
      .join(" ") + " Z"
  );
})();

export const CogArt = ({ size = 20 }) => (
  <Art size={size}>
    <path
      d={COG_ICON_PATH}
      stroke="#6C3FD4"
      fill="none"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
    <circle
      stroke="#6C3FD4"
      fill="none"
      strokeWidth="1.3"
      cx="12"
      cy="12"
      r="2.6"
    />
    <circle fill="#D4A33F" stroke="#D4A33F" r="1.2" cx="12" cy="12" />
  </Art>
);

// Constraint type -> its toolbar artwork.  A type missing here keeps its own
// line-drawn marker in the sketch view.
export const CONSTRAINT_ICON_ART = {
  coincident: CoincidentArt,
  midpoint: MidpointArt,
  distance: DistanceArt,
  horizontal: HorizontalArt,
  vertical: VerticalArt,
  parallel: ParallelArt,
  colinear: ColinearArt,
  tangent: TangentArt,
  equal: EqualArt,
  centre: CentreArt,
  circularPattern: CircularPatternArt,
  cog: CogArt,
};
