// What a timeline step is called.  Pure, so the wording can be tested without
// rendering the Timeline.

// Detect chamfer / fillet entries by looking at the instruction payload —
// covers both newly-labelled entries ("Chamfered" / "Filleted") and old
// "Modified" entries written before the label change.
export const chamferInfo = (entry) => {
  const inst = entry?.instruction;
  if (inst?.type !== "modify") return null;
  const r = inst.patches?.regenerator;
  if (r?.kind !== "chamfer") return null;
  return { isFillet: r.segments !== 1 };
};

const getItemName = (history, itemId) => {
  for (let i = history.length - 1; i >= 0; i--) {
    const inst = history[i].instruction;
    if (inst.type === "create" && inst.item && inst.item.id === itemId) {
      return inst.item.name;
    }
    if (inst.type === "createGroup" && inst.items) {
      const m = inst.items.find((it) => it.id === itemId);
      if (m) return m.name;
    }
  }
  return `#${itemId}`;
};

// The text a timeline step shows.
export const getDisplayLabel = (entry, history) => {
  // Promote legacy "Modified" entries that contain a chamfer regenerator
  // to "Chamfered" / "Filleted" so the label matches the entry's actual
  // operation regardless of when it was recorded.
  const ci = chamferInfo(entry);
  const label =
    ci && entry.label === "Modified"
      ? ci.isFillet
        ? "Filleted"
        : "Chamfered"
      : entry.label;
  const inst = entry.instruction;
  if (inst?.type === "createGroup") {
    // A split names the body it cut.  Its pieces are made in one createGroup,
    // and this used to fall through to the count below: "Split 2 extrusions",
    // for halves that are not extrusions.
    if (inst.splitFrom != null)
      return `${label} ${getItemName(history, inst.splitFrom)}`;
    // Otherwise several items at once (a multi-area extrude's prisms): name it
    // by count rather than one arbitrary member, calling them what they are.
    const items = inst.items || [];
    // A group of one -- an extrude whose fuse fell back to a separate body --
    // read "Extruded 1 extrusions"; name the item instead.
    if (items.length === 1) return `${label} ${items[0].name}`;
    const noun = items.every((it) => it.type === "extrude")
      ? "extrusions"
      : "bodies";
    return `${label} ${items.length} ${noun}`;
  }
  if (entry.itemId != null) {
    return `${label} ${getItemName(history, entry.itemId)}`;
  }
  return label;
};
