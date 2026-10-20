// The toolbar artwork for each sketch constraint (and the circular pattern
// link), in ONE place: the toolbar buttons render these, and the sketch view
// rasterises the very same components for the markers it draws beside each
// constraint (three/sceneObjects/constraintIconSprites.js), so a marker always
// looks like the button that made it.  The artwork itself is cad-icons/*.svg.

import SvgIcon from "./SvgIcon.jsx";

const art = (name) => {
  const Art = ({ size = 20 }) => <SvgIcon name={name} size={size} />;
  return Art;
};

export const CoincidentArt = art("coincident");
export const MidpointArt = art("midpoint");
export const DistanceArt = art("distance");
export const HorizontalArt = art("horizontal");
export const VerticalArt = art("vertical");
// The horizontal/vertical button at rest, with no line selected to choose
// between them.
export const HorizontalVerticalArt = art("horizontal-vertical");
export const ParallelArt = art("parallel");
export const ColinearArt = art("colinear");
export const TangentArt = art("tangent");
export const EqualArt = art("equal");
export const CentreArt = art("centre");
export const CircularPatternArt = art("circular-pattern");
// Traced from a real 8-tooth cog's outline (pitch diameter 16) when the icon
// was made; the file is a plain path now, to be edited like the rest.
export const CogArt = art("cog");

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
