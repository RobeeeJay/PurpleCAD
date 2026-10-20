// Icons are SVG files saved from Affinity Designer; these check that what it
// writes renders inline as the hand-written icons did.
import { describe, it, expect } from "vitest";
import { cleanIconSvg } from "../cleanIconSvg.js";

// As Affinity Designer 2 exports a 24 x 24 icon.
const AFFINITY = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg width="100%" height="100%" viewBox="0 0 24 24" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" xmlns:serif="http://www.serif.com/" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linecap:round;stroke-linejoin:round;stroke-miterlimit:1.5;">
    <g id="Layer1" serif:id="Layer 1">
        <path d="M4,12L20,12" style="fill:none;stroke:rgb(255,0,255);stroke-width:1.5px;"/>
        <circle cx="12" cy="12" r="3" style="fill:url(#_Linear1);"/>
        <rect x="2" y="2" width="4" height="4" style="fill:#FF00FF;"/>
    </g>
    <defs>
        <linearGradient id="_Linear1" x1="0" y1="0" x2="1" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" style="stop-color:#6C3FD4;stop-opacity:1"/></linearGradient>
    </defs>
</svg>
`;

describe("cleaning an icon saved from a drawing program", () => {
  const icon = cleanIconSvg(AFFINITY, "union");

  it("keeps only what renders: no prolog, DOCTYPE or editor attributes", () => {
    expect(icon.body).not.toMatch(/<\?xml|DOCTYPE|serif:|xml:space|<svg/);
    expect(icon.body).toMatch(/^<g id="union__Layer1">/);
  });

  it("turns the reserved magenta into the UI's colour, however it is written", () => {
    expect(icon.body).not.toMatch(/255,0,255|#FF00FF/i);
    expect(icon.body).toContain("stroke:currentColor");
    expect(icon.body).toContain("fill:currentColor");
    // Other colours are the artwork's own.
    expect(icon.body).toContain("#6C3FD4");
  });

  it("prefixes ids with the icon's name, references and all", () => {
    // Affinity calls the first gradient _Linear1 in every file.
    expect(icon.body).toContain('id="union___Linear1"');
    expect(icon.body).toContain("url(#union___Linear1)");
    expect(icon.body).not.toMatch(/url\(#_Linear1\)/);
  });

  it("carries the root's styling onto the svg element as React props", () => {
    expect(icon.viewBox).toBe("0 0 24 24");
    expect(icon.attrs).toEqual({
      fillRule: "evenodd",
      clipRule: "evenodd",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeMiterlimit: "1.5",
    });
  });

  it("drops a title, which would show its own tooltip over the button's", () => {
    const t = cleanIconSvg(
      '<svg viewBox="0 0 24 24"><title>Layer</title><path d="M0 0"/></svg>',
      "x",
    );
    expect(t.body).toBe('<path d="M0 0"/>');
  });

  it("takes a viewBox from the size when a file has none", () => {
    expect(
      cleanIconSvg('<svg width="16" height="16"><path/></svg>', "x").viewBox,
    ).toBe("0 0 16 16");
  });
});
