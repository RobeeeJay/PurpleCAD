// The beta warning has to reach every new user once, and then stay out of the
// way: a dialog that came back on each launch would be dismissed unread.

import { describe, it, expect } from "vitest";
import { welcomeDue, markWelcomeSeen } from "../internals.js";
import * as db from "../db.js";
import { parseMarkdown } from "../../components/licenseMarkdown.js";
import welcome from "../../../WELCOME.md?raw";

describe("the welcome dialog", () => {
  it("is due on a first launch and not after it has been dismissed", () => {
    db.settingRemove("welcomeSeen");
    expect(welcomeDue(), "fresh profile").toBe(true);
    markWelcomeSeen();
    expect(
      welcomeDue(),
      `welcomeSeen = ${JSON.stringify(db.settingGet("welcomeSeen"))}`,
    ).toBe(false);
  });

  it("takes its title from WELCOME.md's first heading", () => {
    const blocks = parseMarkdown(welcome);
    const heading = blocks.find((b) => b.type === "heading");
    expect(heading?.text.map((r) => r.v).join("")).toBe("Welcome to PurpleCAD");
    expect(blocks.filter((b) => b.type === "para").length).toBeGreaterThan(0);
  });
});
