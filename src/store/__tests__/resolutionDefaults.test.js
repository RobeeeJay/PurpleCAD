// One Resolution setting, 0.05 mm by default.  There used to be a Normal and a
// High value with a toolbar toggle; the Normal one a user had set carries over
// as the Resolution.  A stored value that can't be read falls back to the
// default, not to some other number.
import { describe, it, expect } from "vitest";
import * as db from "../db.js";
import { loadSnapSettings } from "../internals.js";

describe("the resolution setting", () => {
  it("starts at 0.05 mm", () => {
    db.settingRemove("snap");
    expect(loadSnapSettings().resolutionMm).toBe(0.05);
  });

  it("falls back to the default when the stored value is unusable", () => {
    db.settingSet("snap", JSON.stringify({ resolutionMm: 0 }));
    expect(loadSnapSettings().resolutionMm).toBe(0.05);
    db.settingRemove("snap");
  });

  it("keeps a value the user chose", () => {
    db.settingSet("snap", JSON.stringify({ resolutionMm: 0.1 }));
    expect(loadSnapSettings().resolutionMm).toBe(0.1);
    db.settingRemove("snap");
  });

  it("takes over the old Normal value, not the old High one", () => {
    db.settingSet(
      "snap",
      JSON.stringify({ previewPrecisionMm: 0.2, printPrecisionMm: 0.01 }),
    );
    expect(loadSnapSettings().resolutionMm).toBe(0.2);
    db.settingRemove("snap");
  });
});
