// Every icon the code names has a file in cad-icons/, and every file there
// loads.  A missing or misspelt name only fails when its component renders,
// which for a dropdown or a dialog can be a long way into a session.
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { ICONS } from "../SvgIcon.jsx";

const SRC = path.resolve(__dirname, "../../..");

const sources = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : sources(p);
    return /\.jsx?$/.test(e.name) ? [p] : [];
  });

describe("the icon files", () => {
  it("cover every icon name in the code", () => {
    const used = new Set();
    for (const f of sources(SRC)) {
      const s = fs.readFileSync(f, "utf8");
      for (const m of s.matchAll(/<SvgIcon\b[^>]*?\bname="([^"]+)"/g))
        used.add(m[1]);
      for (const m of s.matchAll(/\bart\("([^"]+)"\)/g)) used.add(m[1]);
    }
    expect(used.size, "names found in the code").toBeGreaterThan(100);
    const missing = [...used].filter((n) => !ICONS[n]);
    expect(missing, "names with no cad-icons/<name>.svg").toEqual([]);
  });

  it("all load, each with something to draw", () => {
    const empty = Object.entries(ICONS)
      .filter(([, icon]) => !/<\w/.test(icon.body))
      .map(([name]) => name);
    expect(empty, "icons with an empty body").toEqual([]);
  });
});
