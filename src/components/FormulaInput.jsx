import React, {
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
} from "react";
import { createPortal } from "react-dom";
import { evaluateFormula, variablesToMap } from "../utils/formulas.js";
import {
  placeSuggestions,
  VIEWPORT_MARGIN,
} from "./formulaSuggestPlacement.js";
import "../styles/FormulaInput.css";

// A drop-in <input> replacement that pops up a list of matching variable
// names as the user types an identifier.  Handles controlled and
// uncontrolled inputs alike: the parent's onChange (if any) still fires
// for both real keystrokes and programmatic suggestion-accepts, courtesy
// of the native HTMLInputElement value setter + bubbled input event.
//
// Keyboard:
//   • ArrowDown / ArrowUp — move the highlight
//   • Enter / Tab         — accept the highlighted suggestion
//   • Escape              — dismiss the popup (does NOT bubble to the
//                           parent's Escape handler so dialogs stay open)
//   • any other key       — bubbles to the parent's onKeyDown unchanged
//
// `variables` is the same { name, formula } array stored in the store.

const IDENT_START = /[A-Za-z_]/;
const IDENT_REST = /[A-Za-z0-9_]/;

// Return [start, end] of the identifier surrounding cursor position `pos`
// inside `text`, or null if the cursor isn't in/at the end of an identifier.
function identifierRange(text, pos) {
  let start = pos;
  while (start > 0 && IDENT_REST.test(text[start - 1])) start--;
  if (start === pos) return null;
  if (!IDENT_START.test(text[start])) return null; // starts with a digit → numeric literal
  let end = pos;
  while (end < text.length && IDENT_REST.test(text[end])) end++;
  return [start, end];
}

// Fire the native input setter + a synthetic input event so React's
// onChange runs with the new value (otherwise React thinks the value
// hasn't changed and skips the handler).
function applyValueWithEvent(input, newText) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (setter) setter.call(input, newText);
  else input.value = newText;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const MAX_SUGGESTIONS = 8;
const LIST_MAX_WIDTH = 280;

// The list is rendered into document.body with fixed positioning, NOT inside
// the input's wrapper.  Inside, any ancestor with overflow: hidden clipped it,
// any ancestor's stacking context could bury it under a sibling however high
// its own z-index, and in the bars docked at the bottom of the viewport it ran
// off the screen.  Out here it sits above everything, and is placed from the
// input's on-screen rectangle -- below it, or above when below won't fit
// (formulaSuggestPlacement.js).
function positionList(list, input) {
  // Measure at natural height (clear the cap a previous placement set) and at
  // the width it will actually be drawn.
  list.style.maxHeight = "";
  list.style.maxWidth = `${Math.min(
    LIST_MAX_WIDTH,
    window.innerWidth - 2 * VIEWPORT_MARGIN,
  )}px`;
  list.style.minWidth = `${input.offsetWidth}px`;
  const rect = input.getBoundingClientRect();
  const p = placeSuggestions({
    input: rect,
    list: { width: list.offsetWidth, height: list.offsetHeight },
    viewport: { width: window.innerWidth, height: window.innerHeight },
  });
  list.style.top = `${p.top}px`;
  list.style.left = `${p.left}px`;
  list.style.maxHeight = p.maxHeight == null ? "" : `${p.maxHeight}px`;
  list.dataset.placement = p.placement;
}

const FormulaInput = React.forwardRef(function FormulaInput(
  { variables, onChange, onKeyDown, onBlur, ...rest },
  forwardedRef,
) {
  const innerRef = useRef(null);
  const setRefs = useCallback(
    (el) => {
      innerRef.current = el;
      if (typeof forwardedRef === "function") forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    },
    [forwardedRef],
  );

  const [suggestions, setSuggestionsState] = useState([]);
  const [highlighted, setHighlighted] = useState(0);
  // The names on show, to tell a new list from a re-run of the same match.
  const shownRef = useRef("");
  const setSuggestions = useCallback((list) => {
    const key = list.map((s) => s.name).join("\n");
    // The match re-runs on a click in the field, and on the selection event
    // React sends with the first key after the value changes -- which used to
    // swallow that key's ArrowDown.  Only a DIFFERENT list starts again from
    // the top.
    if (key !== shownRef.current) {
      shownRef.current = key;
      setHighlighted(0);
    }
    setSuggestionsState(list);
  }, []);
  const listRef = useRef(null);

  // Place the list before it is painted, and keep it with the input while the
  // page scrolls (any scrolling ancestor, hence capture) or the window resizes.
  const open = suggestions.length > 0;
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      if (listRef.current && innerRef.current)
        positionList(listRef.current, innerRef.current);
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, suggestions]);

  // A list capped to the room available scrolls; keep the arrow-key choice in
  // view.
  useEffect(() => {
    listRef.current?.children[highlighted]?.scrollIntoView?.({
      block: "nearest",
    });
  }, [highlighted]);

  const recompute = useCallback(() => {
    const input = innerRef.current;
    if (!input) {
      setSuggestions([]);
      return;
    }
    const text = input.value || "";
    const pos = input.selectionStart ?? text.length;
    const range = identifierRange(text, pos);
    if (!range) {
      setSuggestions([]);
      return;
    }
    const [start, end] = range;
    const prefix = text.slice(start, end);
    const matches = (variables || [])
      .filter(
        (v) =>
          v &&
          typeof v.name === "string" &&
          v.name.length > 0 &&
          v.name !== prefix &&
          v.name.toLowerCase().startsWith(prefix.toLowerCase()),
      )
      .slice(0, MAX_SUGGESTIONS);
    setSuggestions(matches);
  }, [variables, setSuggestions]);

  // When the parent flips the controlled value (eg mouse-drag rewrites the
  // depth field), refresh the suggestion list against the new content.
  useEffect(() => {
    recompute();
  }, [rest.value, recompute]);

  const acceptSuggestion = (sug) => {
    const input = innerRef.current;
    if (!input) return;
    const text = input.value || "";
    const pos = input.selectionStart ?? text.length;
    const range = identifierRange(text, pos);
    if (!range) {
      setSuggestions([]);
      return;
    }
    const [start, end] = range;
    const newText = text.slice(0, start) + sug.name + text.slice(end);
    applyValueWithEvent(input, newText);
    // Move the cursor to the end of the inserted name.
    const caret = start + sug.name.length;
    requestAnimationFrame(() => {
      input.setSelectionRange(caret, caret);
    });
    setSuggestions([]);
  };

  const handleChange = (e) => {
    if (onChange) onChange(e);
    // Defer until after the value has been committed so selectionStart
    // reflects the post-keystroke caret position.
    queueMicrotask(recompute);
  };

  const handleKeyDown = (e) => {
    if (suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => (h + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted(
          (h) => (h - 1 + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        acceptSuggestion(suggestions[highlighted]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setSuggestions([]);
        return;
      }
    }
    if (onKeyDown) onKeyDown(e);
  };

  const handleSelect = () => recompute();
  const handleClick = () => recompute();
  const handleFocus = () => recompute();

  const handleBlur = (e) => {
    // Allow mousedown on a suggestion to fire (it preventDefaults the
    // blur).  Then close the popup after a tick.
    setTimeout(() => setSuggestions([]), 100);
    if (onBlur) onBlur(e);
  };

  const map = variablesToMap(variables);

  return (
    <span className="formula-input-wrap">
      <input
        ref={setRefs}
        {...rest}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        onClick={handleClick}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      {open &&
        createPortal(
          <div className="formula-suggestions" role="listbox" ref={listRef}>
            {suggestions.map((s, i) => {
              const v = evaluateFormula(s.formula, map);
              return (
                <div
                  key={s.name}
                  role="option"
                  aria-selected={i === highlighted}
                  className={
                    "formula-suggestion" + (i === highlighted ? " active" : "")
                  }
                  onMouseDown={(e) => {
                    // preventDefault so the input doesn't blur (which would
                    // race the suggestion-accept timer).
                    e.preventDefault();
                    setHighlighted(i);
                    acceptSuggestion(s);
                  }}
                >
                  <span className="formula-suggestion-name">{s.name}</span>
                  <span className="formula-suggestion-value">
                    = {Number.isFinite(v) ? v : "—"}
                  </span>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </span>
  );
});

export default FormulaInput;
