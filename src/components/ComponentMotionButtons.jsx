// A component row's motion controls in the Objects list: set the motion up,
// and play / stop it.  Play appears once the component has a motion; after a
// collision has paused it, the button is red and pressing it carries on.

import { useStore } from "../store";
import { MotionIcon, PauseIcon, PlayIcon } from "./icons/componentIcons.jsx";

export default function ComponentMotionButtons({ folder }) {
  const playing = useStore((s) => !!s.motionPlaying[folder.id]);
  const collided = useStore((s) => s.motionCollision?.folderId === folder.id);
  const openMotionTool = useStore((s) => s.openMotionTool);
  const toggleMotionPlaying = useStore((s) => s.toggleMotionPlaying);
  const hasMotion = !!folder.motion;

  return (
    <>
      <button
        className={`tree-action-btn motion-btn ${hasMotion ? "always-visible" : ""}`}
        title="Motion — set how this component moves: a rotation or a slide along an axis"
        onClick={(e) => {
          e.stopPropagation();
          openMotionTool(folder.id);
        }}
      >
        <MotionIcon />
      </button>
      {hasMotion && (
        <button
          className={`tree-action-btn play-btn always-visible ${playing ? "active" : ""}`}
          title={
            collided
              ? "Stopped by a collision — press to carry on"
              : playing
                ? "Stop the motion"
                : "Play the motion"
          }
          style={collided ? { color: "#ff4040" } : undefined}
          onClick={(e) => {
            e.stopPropagation();
            toggleMotionPlaying(folder.id);
          }}
        >
          {playing && !collided ? <PauseIcon /> : <PlayIcon />}
        </button>
      )}
    </>
  );
}
