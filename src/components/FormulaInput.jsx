import React, { useRef, useState, useEffect, useCallback } from "react";
import { evaluateFormula, variablesToMap } from "../utils/formulas.js";
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

  const [suggestions, setSuggestions] = useState([]);
  const [highlighted, setHighlighted] = useState(0);

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
    setHighlighted(0);
  }, [variables]);

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
      {suggestions.length > 0 && (
        <div className="formula-suggestions" role="listbox">
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
        </div>
      )}
    </span>
  );
});

export default FormulaInput;
