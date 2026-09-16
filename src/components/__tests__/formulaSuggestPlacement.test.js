// The variable-name suggestion list must be wholly on screen: below the field
// when it fits, above when it doesn't, inside the window sideways, and
// scrolling in whatever room there is when neither side is big enough.
import { describe, it, expect } from "vitest";
import {
  placeSuggestions,
  SUGGEST_GAP,
  VIEWPORT_MARGIN,
} from "../formulaSuggestPlacement.js";

const viewport = { width: 1400, height: 900 };
const field = (top, left = 400, height = 22, width = 60) => ({
  top,
  bottom: top + height,
  left,
  right: left + width,
});
const list = { width: 180, height: 200 };

const onScreen = (p, l) => {
  const height = p.maxHeight ?? l.height;
  expect(p.top).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  expect(p.top + height).toBeLessThanOrEqual(viewport.height - VIEWPORT_MARGIN);
  expect(p.left).toBeGreaterThanOrEqual(VIEWPORT_MARGIN);
  expect(p.left + Math.min(l.width, p.maxWidth)).toBeLessThanOrEqual(
    viewport.width - VIEWPORT_MARGIN,
  );
};

describe("where the suggestion list goes", () => {
  it("opens below a field with room beneath it", () => {
    const input = field(100);
    const p = placeSuggestions({ input, list, viewport });
    expect(p.placement).toBe("below");
    expect(p.top).toBe(input.bottom + SUGGEST_GAP);
    expect(p.left).toBe(input.left);
    expect(p.maxHeight).toBeNull();
    onScreen(p, list);
  });

  it("opens ABOVE a field near the bottom of the window", () => {
    // The sketch tool bars sit at the bottom of the viewport: below would run
    // straight off the screen.
    const input = field(850);
    const p = placeSuggestions({ input, list, viewport });
    expect(p.placement).toBe("above");
    // Its bottom edge sits just above the field.
    expect(p.top + list.height).toBe(input.top - SUGGEST_GAP);
    expect(p.maxHeight).toBeNull();
    onScreen(p, list);
  });

  it("slides left to stay inside the window at the right edge", () => {
    const input = field(100, 1350);
    const p = placeSuggestions({ input, list, viewport });
    expect(p.left).toBe(viewport.width - VIEWPORT_MARGIN - list.width);
    onScreen(p, list);
  });

  it("stays inside the window at the left edge", () => {
    const input = field(100, -30);
    const p = placeSuggestions({ input, list, viewport });
    expect(p.left).toBe(VIEWPORT_MARGIN);
    onScreen(p, list);
  });

  it("scrolls in the roomier side when it fits on neither", () => {
    const tall = { width: 180, height: 800 };
    const input = field(300); // more room below (578) than above (288)
    const p = placeSuggestions({ input, list: tall, viewport });
    expect(p.placement).toBe("below");
    expect(p.maxHeight).toBe(
      viewport.height - input.bottom - SUGGEST_GAP - VIEWPORT_MARGIN,
    );
    onScreen(p, tall);

    const high = field(600); // now more room above
    const q = placeSuggestions({ input: high, list: tall, viewport });
    expect(q.placement).toBe("above");
    expect(q.maxHeight).toBe(high.top - SUGGEST_GAP - VIEWPORT_MARGIN);
    onScreen(q, tall);
  });

  it("stays on screen for a field scrolled partly out of the window", () => {
    const p = placeSuggestions({ input: field(-15), list, viewport });
    expect(p.placement).toBe("below");
    onScreen(p, list);
  });

  it("is never wider than the window", () => {
    const narrow = { width: 300, height: 700 };
    const wide = { width: 500, height: 200 };
    const p = placeSuggestions({
      input: field(100, 100),
      list: wide,
      viewport: narrow,
    });
    expect(p.maxWidth).toBe(narrow.width - 2 * VIEWPORT_MARGIN);
    expect(p.left).toBe(VIEWPORT_MARGIN);
  });
});
