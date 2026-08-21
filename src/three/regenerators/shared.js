// Shared helper for the regenerators: re-anchoring a chained op to its live
// source.  Split out of regenerateItems.js — it's the one piece every family
// needs, so it lives on its own rather than being owned by any of them.

import * as THREE from "three";
import { buildBrushTransform } from "../csgUtils.js";

// Re-anchor a chained op's item position to its LIVE source every recalc.
//
// A chamfer/emboss/hole/… is placed at its source's brush position plus its
// bbox-centre offset; the user may then gizmo-MOVE it, adding a world delta.
// Storing the absolute position and KEEPING it (the old behaviour) breaks the
// instant an insert/edit repoints the source (relinkSourceChain): the geometry
// rebuilds on the NEW source while the position stays pinned to the OLD one, so
// the object shifts — the recurring "inserting a chamfer after a chamfer moves
// the body" bug.  Instead we remember the SOURCE BRUSH position we last anchored
// to (regenerator.basePosition) and shift the on-screen position by however much
// that brush point moved.  Deliberately keyed on the brush point alone, NOT the
// centre-offset: a resolution toggle re-tessellates and nudges the bbox centre
// slightly, and we must NOT let that jitter the object (the old code kept the
// position fixed on a toggle for exactly this reason).
export function resolveChainedPosition(
  source,
  centerOffset,
  currentPosition,
  storedBrush,
) {
  const brushPos = buildBrushTransform(source).position;
  // Common path: shift the current position by the source-brush delta, so an
  // insert/edit that moved the source carries the body with it, while a
  // resolution toggle (same source, zero delta) leaves it untouched.
  if (storedBrush && currentPosition) {
    return {
      position: {
        x: currentPosition.x + (brushPos.x - storedBrush.x),
        y: currentPosition.y + (brushPos.y - storedBrush.y),
        z: currentPosition.z + (brushPos.z - storedBrush.z),
      },
      base: brushPos,
    };
  }
  // Legacy item (no recorded brush) but a position exists: keep it, and record
  // the brush so the NEXT recalc can re-anchor precisely.
  if (currentPosition) return { position: currentPosition, base: brushPos };
  // No current position (a fresh sketch-driven rebuild): place it at the full
  // source-anchored base (brush + centre-offset rotated into the source frame).
  const { cx, cy, cz } = centerOffset;
  const rot = source.rotation || { x: 0, y: 0, z: 0 };
  const local = new THREE.Vector3(cx, cy, cz).applyEuler(
    new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0),
  );
  return {
    position: {
      x: brushPos.x + local.x,
      y: brushPos.y + local.y,
      z: brushPos.z + local.z,
    },
    base: brushPos,
  };
}
