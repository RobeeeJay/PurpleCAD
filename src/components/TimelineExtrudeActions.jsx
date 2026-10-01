import { useStore } from "../store";
import { EditIcon } from "./toolbar/timelineIcons.jsx";

// Edit control for an extrude entry.  Editing re-enters profile-select mode
// seeded with the extrude's current profile, so the user can change the profile
// AND the length and Confirm edits the entry in place (retargetExtrude).  With
// `groupIds` it acts on a whole multi-area group as one unit; otherwise on the
// single `itemId`.
export default function ExtrudeActions({ itemId, groupIds, fusedId, entryId }) {
  const extrudeSelectMode = useStore((s) => s.extrudeSelectMode);
  const extrudeRetargetId = useStore((s) => s.extrudeRetargetId);
  const extrudeRetargetGroup = useStore((s) => s.extrudeRetargetGroup);
  const extrudeRetargetFusedId = useStore((s) => s.extrudeRetargetFusedId);
  const setExtrudeRetargetId = useStore((s) => s.setExtrudeRetargetId);
  const setExtrudeRetargetGroup = useStore((s) => s.setExtrudeRetargetGroup);
  const setExtrudeRetargetFusedId = useStore(
    (s) => s.setExtrudeRetargetFusedId,
  );
  const setExtrudeSelectMode = useStore((s) => s.setExtrudeSelectMode);
  const isGroup = !!groupIds;
  const isFused = fusedId != null;
  const editActive =
    extrudeSelectMode === "profile" &&
    (isFused
      ? extrudeRetargetFusedId === fusedId
      : isGroup
        ? !!extrudeRetargetGroup && extrudeRetargetGroup[0] === groupIds[0]
        : !extrudeRetargetGroup && extrudeRetargetId === itemId);
  return (
    <button
      className={`timeline-action-btn${editActive ? " active" : ""}`}
      title="Edit extrusion — change the profile and length, then Confirm"
      onClick={(e) => {
        e.stopPropagation();
        // Enter profile mode FIRST: setExtrudeSelectMode spreads
        // TOOL_RESET_PATCH when freshly entering extrude, which nulls
        // extrudeRetargetId/Group/Fused — so arming the edit target before it
        // would be wiped, and Confirm would build a NEW extrude instead of
        // editing.
        // Show the scene as it was when the extrusion was made -- its own
        // step, with what was shown and hidden then -- and come back after
        // (extrudeEditReturn).  Its own step, not the one before: the edit
        // works on the extrusion, which doesn't exist before it.
        const back = { to: useStore.getState().activeHistoryId };
        if (entryId != null) useStore.getState().restoreToHistory(entryId);
        setExtrudeSelectMode("profile");
        setExtrudeRetargetGroup(isGroup ? groupIds : null);
        setExtrudeRetargetFusedId(isFused ? fusedId : null);
        setExtrudeRetargetId(isFused ? null : isGroup ? groupIds[0] : itemId);
        useStore.setState({ extrudeEditReturn: back });
      }}
    >
      <EditIcon />
    </button>
  );
}
