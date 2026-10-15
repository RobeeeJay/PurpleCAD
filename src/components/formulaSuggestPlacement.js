// Where to put a FormulaInput's suggestion list so all of it is on screen.
//
// The list opens below the input.  If that would run off the bottom of the
// window -- a field in a bar docked at the bottom of the viewport, say -- it
// opens above instead.  If it fits on neither side, it takes the roomier side
// and scrolls within the space there.  It is also slid sideways to stay inside
// the window, and never gets wider than the window.
//
// Pure: the component measures the input and the list and applies the result,
// so this can be tested without a browser.

export const SUGGEST_GAP = 4; // between the input and the list
export const VIEWPORT_MARGIN = 8; // kept clear at every window edge

export function placeSuggestions({ input, list, viewport }) {
  const room = viewport.height - 2 * VIEWPORT_MARGIN;
  const below = viewport.height - input.bottom - SUGGEST_GAP - VIEWPORT_MARGIN;
  const above = input.top - SUGGEST_GAP - VIEWPORT_MARGIN;

  let placement;
  if (list.height <= below) placement = "below";
  else if (list.height <= above) placement = "above";
  else placement = above > below ? "above" : "below";
  const space = Math.max(
    0,
    Math.min(room, placement === "above" ? above : below),
  );
  const height = Math.min(list.height, space);

  const maxWidth = viewport.width - 2 * VIEWPORT_MARGIN;
  const width = Math.min(list.width, maxWidth);
  const left = Math.min(
    Math.max(input.left, VIEWPORT_MARGIN),
    viewport.width - VIEWPORT_MARGIN - width,
  );
  const wanted =
    placement === "above"
      ? input.top - SUGGEST_GAP - height
      : input.bottom + SUGGEST_GAP;
  // A field scrolled partly out of the window still gets its list on screen.
  const top = Math.min(
    Math.max(wanted, VIEWPORT_MARGIN),
    viewport.height - VIEWPORT_MARGIN - height,
  );

  return {
    placement,
    top,
    left,
    maxHeight: height < list.height ? height : null,
    maxWidth,
  };
}
