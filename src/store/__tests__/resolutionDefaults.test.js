// The two resolutions start at 0.05 mm (normal) and 0.01 mm (high).  Normal
// was 0.1, and a stored value that couldn't be read fell back to 0.5 -- a
// different default depending on how the settings were lost.
import { describe, it, expect } from "vitest";
import * as db from "../db.js";
import { loadSnapSettings } from "../internals.js";

describe("resolution settings", () => {
  it("start at 0.05 mm normal and 0.01 mm high", () => {
    db.settingRemove("snap");
    const s = loadSnapSettings();
    expect([s.previewPrecisionMm, s.printPrecisionMm]).toEqual([0.05, 0.01]);
  });

  it("fall back to the same defaults when the stored values are unusable", () => {
    db.settingSet(
      "snap",
      JSON.stringify({ previewPrecisionMm: 0, printPrecisionMm: -1 }),
    );
    const s = loadSnapSettings();
    expect([s.previewPrecisionMm, s.printPrecisionMm]).toEqual([0.05, 0.01]);
    db.settingRemove("snap");
  });

  it("keep a value the user chose", () => {
    db.settingSet("snap", JSON.stringify({ previewPrecisionMm: 0.1 }));
    expect(loadSnapSettings().previewPrecisionMm).toBe(0.1);
    db.settingRemove("snap");
  });
});
