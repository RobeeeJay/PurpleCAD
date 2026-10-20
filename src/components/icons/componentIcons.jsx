// Icons for components in the Objects list: the component itself (a part), a
// new-component button, and the component's motion controls.  The artwork is
// cad-icons/*.svg.

import SvgIcon from "./SvgIcon.jsx";

export const ComponentIcon = () => <SvgIcon name="component" size={16} />;
export const NewComponentIcon = () => (
  <SvgIcon name="new-component" size={16} />
);
export const MotionIcon = () => <SvgIcon name="motion" size={16} />;
export const PlayIcon = () => <SvgIcon name="play" size={16} />;
export const PauseIcon = () => <SvgIcon name="pause" size={16} />;
