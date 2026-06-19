// Shell (hollow) commit.  Unlike chamfer/push-pull there's no face-pick phase:
// the whole selected body is hollowed to a wall of the dialog's thickness.
// Mirrors commitPushPull's structure — snapshot the live source, run the
// shellItem op, and modify the body into a `csg` item with a "shell" recipe so
// it rebuilds from its source on regen and chains into further ops.

import { useStore } from "../../store";
import { MM_PER_UNIT } from "../sceneObjects.js";
import { withLivePolygons } from "../csgUtils.js";
import { chamferResultTransform } from "./chamferCommit.js";

export async function commitShell({
  item,
  items,
  thicknessMm,
  printPrecision,
}) {
  const { shellItem } = await import("../occClient.js");
  const store = useStore.getState();
  const thickness = thicknessMm / MM_PER_UNIT;
  if (!(thickness > 0)) return false;

  // Freeze the live source (re-derives an extrude's polygon, etc.) so a sketch
  // edit before confirming is baked in and the recipe can rebuild later.
  const source = withLivePolygons({ ...item }, items, printPrecision);

  const result = await shellItem({
    source,
    thickness,
    allItems: items,
    printPrecision,
  });
  if (!result) return false;

  const { geometryData, centerOffset } = result;
  const { position } = chamferResultTransform(source, centerOffset);
  const patches = {
    type: "csg",
    position,
    regenerator: {
      kind: "shell",
      thickness,
      source,
      centerOffset,
      regeneratedAt: printPrecision,
    },
    geometryData,
  };
  store.modifyItem(item.id, patches, "Shelled");
  return true;
}
