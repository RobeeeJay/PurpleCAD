// "Check for updates" is on unless the user turned it off: a profile from
// before the setting existed has no value stored, and must still be told
// about new releases.  "Skip this version" remembers exactly one version.
import { describe, it, expect } from "vitest";
import * as db from "../db.js";
import {
  loadSnapSettings,
  saveSnapSettings,
  skipUpdateVersion,
  skippedUpdateVersion,
} from "../internals.js";

describe("the update settings", () => {
  it("check for updates by default, including on a profile saved before the setting", () => {
    db.settingRemove("snap");
    expect(loadSnapSettings().checkForUpdates).toBe(true);
    db.settingSet("snap", JSON.stringify({ resolutionMm: 0.1 }));
    expect(loadSnapSettings().checkForUpdates).toBe(true);
    db.settingRemove("snap");
  });

  it("stay off once turned off", () => {
    saveSnapSettings({ ...loadSnapSettings(), checkForUpdates: false });
    expect(loadSnapSettings().checkForUpdates).toBe(false);
    db.settingRemove("snap");
  });

  it("remember the skipped version, and only the latest one skipped", () => {
    skipUpdateVersion("1.0.2");
    expect(skippedUpdateVersion()).toBe("1.0.2");
    skipUpdateVersion("1.0.3");
    expect(skippedUpdateVersion()).toBe("1.0.3");
    db.settingRemove("skippedUpdate");
  });
});
