// Regression: selecting a constraint recolours its icon to the selection
// colour; deselecting must restore the icon's ORIGINAL colour.  Recomputing the
// colour from the constraint type (the old behaviour) had no entry for mirror /
// pattern constraints, so their icons reset to the default and appeared to
// vanish on deselect.

import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";

vi.mock("../../store", () => ({
  useStore: { getState: () => ({ theme: "dark" }) },
}));

import { createSketchHoverHelpers } from "../cameraControls/sketchHover.js";

const makeIcon = (constraintType, hex) => {
  const obj = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: hex }),
  );
  obj.userData = {
    isConstraintObj: true,
    isConstraint: true,
    constraintIdx: 0,
    constraintType,
    constraintColor: hex,
  };
  return obj;
};

const makeHelpers = (icon) =>
  createSketchHoverHelpers(
    { sketchShapesGroupRef: { current: { children: [icon] } } },
    { findSnap: () => null, hitTestSketchLines: () => [] },
  );

describe("constraint icon colour survives select → deselect", () => {
  it("restores a rectangular-pattern icon's colour on clear", () => {
    const HEX = 0xff8844; // sketchRectangularPattern dark
    const icon = makeIcon("rectangularPattern", HEX);
    const h = makeHelpers(icon);

    h.selectConstraint(0);
    expect(icon.material.color.getHex()).not.toBe(HEX); // now the selection colour
    h.clearConstraintSelection();
    expect(icon.material.color.getHex()).toBe(HEX); // original restored, not default
  });

  it("restores via the toggle-off path too", () => {
    const HEX = 0x44aaff;
    const icon = makeIcon("mirror", HEX);
    const h = makeHelpers(icon);

    h.selectConstraint(0);
    h.selectConstraint(0); // same idx → toggles selection off
    expect(icon.material.color.getHex()).toBe(HEX);
  });
});
