// The licence dialog draws LICENSE.md, TRADEMARKS.md and
// THIRD_PARTY_LICENSES.md through this small reader.  Tested on the real
// files: they are its only inputs, and a notice or a table row that doesn't
// come through is a licence text shown wrong.
import { describe, it, expect } from "vitest";
import license from "../../../LICENSE.md?raw";
import trademarks from "../../../TRADEMARKS.md?raw";
import thirdParty from "../../../THIRD_PARTY_LICENSES.md?raw";
import { parseMarkdown, inline } from "../licenseMarkdown.js";

const plain = (runs) => runs.map((r) => r.v).join("");

describe("inline", () => {
  it("reads bold, code and a link, keeping the link's URL", () => {
    expect(inline("**Forks** see `LICENSE.md` [here](https://x.org).")).toEqual(
      [
        { t: "strong", v: "Forks" },
        { t: "text", v: " see " },
        { t: "code", v: "LICENSE.md" },
        { t: "text", v: " " },
        { t: "link", v: "here", href: "https://x.org" },
        { t: "text", v: "." },
      ],
    );
  });
});

describe("bare web addresses", () => {
  it("are links, stopping before a closing bracket or full stop", () => {
    // The Required Notice lines put the address in brackets, before a stop.
    expect(
      inline("PurpleCAD (https://github.com/RobeeeJay/PurpleCAD)."),
    ).toEqual([
      { t: "text", v: "PurpleCAD (" },
      {
        t: "link",
        v: "https://github.com/RobeeeJay/PurpleCAD",
        href: "https://github.com/RobeeeJay/PurpleCAD",
      },
      { t: "text", v: ")." },
    ]);
  });

  it("are found in the third-party tables", () => {
    const table = parseMarkdown(thirdParty).find((b) => b.type === "table");
    const sources = table.rows.map((r) => r.at(-1)[0]);
    for (const s of sources) expect(s.t, JSON.stringify(s)).toBe("link");
  });

  it("leave an in-page anchor as a link the dialog won't open", () => {
    // PolyForm's "[Distribution License](#distribution-license)".
    expect(inline("[Distribution License](#distribution-license)")).toEqual([
      { t: "link", v: "Distribution License", href: "#distribution-license" },
    ]);
  });
});

describe("parseMarkdown on the licence files", () => {
  it("keeps every Required Notice line of LICENSE.md, first", () => {
    const blocks = parseMarkdown(license);
    const notices = license
      .split("\n")
      .filter((l) => l.startsWith("Required Notice:"));
    expect(notices).toHaveLength(3);
    expect(blocks.slice(0, 3).map((b) => plain(b.text))).toEqual(notices);
  });

  it("carries the whole PolyForm text: all of its sections", () => {
    const headings = parseMarkdown(license)
      .filter((b) => b.type === "heading")
      .map((b) => plain(b.text));
    expect(headings[0]).toBe("PolyForm Noncommercial License 1.0.0");
    const sections = license
      .split("\n")
      .filter((l) => l.startsWith("## "))
      .map((l) => l.slice(3));
    expect(headings.slice(1)).toEqual(sections);
  });

  it("reads the trademark policy's fork rules as a numbered list", () => {
    const list = parseMarkdown(trademarks).find(
      (b) => b.type === "list" && b.ordered,
    );
    expect(list.items).toHaveLength(3);
    expect(plain(list.items[0].text)).toMatch(/^Takes its own name/);
    // The three places a fork must say where it came from.
    expect(list.items[1].children).toHaveLength(3);
  });

  it("reads every row of the third-party tables", () => {
    const tables = parseMarkdown(thirdParty).filter((b) => b.type === "table");
    const rows = thirdParty
      .split("\n")
      .filter((l) => l.startsWith("|") && !/^\|[\s:|-]+\|$/.test(l));
    expect(
      tables.reduce((n, t) => n + 1 + t.rows.length, 0),
      "header and body rows",
    ).toBe(rows.length);
    const names = tables.flatMap((t) => t.rows.map((r) => plain(r[0])));
    expect(names).toContain("Open CASCADE Technology (OCCT)");
  });
});
