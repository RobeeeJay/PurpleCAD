// Shared helpers for value inputs that drive a live preview / commit.
//
// Conventions enforced across the modify dialogs/overlays (chamfer, push/pull,
// patterns):
//   • live updates are debounced PREVIEW_DEBOUNCE_MS after the last keystroke;
//   • the field may be cleared to blank while typing (no value is forced);
//   • while the field has no valid value, Confirm is disabled and the preview
//     is cleared — no live update fires until it parses again.

import React, { useEffect, useRef, useState } from "react";
import { evaluateFormula, variablesToMap } from "../utils/formulas.js";
import { useStore } from "../store";
import { cancelOcc } from "../three/occClient.js";
import { clearSolids } from "../three/solidCache.js";
import FormulaInput from "./FormulaInput";

export const PREVIEW_DEBOUNCE_MS = 350;

// Evaluate a raw input that may be a plain number or a variable formula.
// Returns a finite number, or NaN when the field is blank / unparseable.
export function evalValue(raw, variables) {
  if (raw == null || String(raw).trim() === "") return NaN;
  const v = evaluateFormula(raw, variablesToMap(variables));
  return Number.isFinite(v) ? v : NaN;
}

// Debounced live-preview driver.  While `valid`, runs `run` once the watched
// `deps` have been stable for PREVIEW_DEBOUNCE_MS; the instant it goes invalid
// it runs `clear` so no stale preview is left behind.  `run`/`clear` are read
// through refs so inline closures don't reset the timer every render.
export function useDebouncedPreview(valid, run, clear, deps) {
  const runRef = useRef(run);
  const clearRef = useRef(clear);
  runRef.current = run;
  clearRef.current = clear;
  useEffect(() => {
    if (!valid) {
      if (clearRef.current) clearRef.current();
      return;
    }
    const t = setTimeout(() => {
      // A previous preview's OCC op may still be running (a slow op that outlived
      // the debounce); it would serialise ahead of this new one and keep eating
      // CPU.  Abort it so the latest preview computes now.  Only when something
      // is actually in flight.
      if (useStore.getState().pendingOperations > 0) {
        cancelOcc();
        clearSolids();
      }
      if (runRef.current) runRef.current();
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valid, ...deps]);
}

// Window-level Escape handler for the bottom-bar tool overlays (which often
// have no focusable input, so an input-level onKeyDown can't catch Esc).  Active
// only while the tool is open; `onEscape` is always read fresh.
export function useEscapeKey(active, onEscape) {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const onKey = (e) => {
      if (e.key === "Escape") ref.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);
}

const fmt = (v) =>
  v == null || (typeof v === "number" && !Number.isFinite(v)) ? "" : String(v);

// A debounced, spinner-free number <input>.  Owns its raw string so it can be
// cleared while typing; pushes the parsed value to `onCommit(num, raw)` once
// editing settles (PREVIEW_DEBOUNCE_MS), on blur, and on Enter — so a keystroke
// no longer triggers a store write / re-render.  Re-seeds only when `value`
// changes from the OUTSIDE (not our own committed echo).  The wheel is disabled
// globally (main.jsx) and spinners via CSS, so it is keyboard-entry only.
//
// Pass `variables` to accept formulas too: a native type="number" input rejects
// any non-digit keystroke outright (so "width/2" couldn't even be typed), so
// this switches to a free-text FormulaInput (suggestions + evalValue parsing)
// instead.  Omitting `variables` keeps the plain numeric-only behaviour.
export function NumberInput({
  value,
  onCommit,
  debounceMs = PREVIEW_DEBOUNCE_MS,
  onKeyDown,
  variables,
  ...rest
}) {
  const [raw, setRaw] = useState(() => fmt(value));
  const seeded = useRef(fmt(value));
  useEffect(() => {
    const f = fmt(value);
    if (f !== seeded.current) {
      seeded.current = f;
      setRaw(f);
    }
  }, [value]);

  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const rawRef = useRef(raw);
  rawRef.current = raw;
  const variablesRef = useRef(variables);
  variablesRef.current = variables;
  const flush = () => {
    const r = rawRef.current;
    seeded.current = r;
    const n = variablesRef.current
      ? evalValue(r, variablesRef.current)
      : r.trim() === ""
        ? NaN
        : Number(r);
    onCommitRef.current?.(n, r);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    if (raw === seeded.current) return; // mount / external echo — nothing new
    const t = setTimeout(() => flushRef.current(), debounceMs);
    return () => clearTimeout(t);
  }, [raw, debounceMs]);

  const handleChange = (e) => setRaw(e.target.value);
  const handleBlur = () => flushRef.current();
  const handleKeyDown = (e) => {
    if (e.key === "Enter") flushRef.current();
    onKeyDown?.(e);
  };

  if (variables) {
    return (
      <FormulaInput
        variables={variables}
        value={raw}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        {...rest}
      />
    );
  }

  return (
    <input
      type="number"
      value={raw}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      {...rest}
    />
  );
}

// A numeric <input> that owns local string state so it can be cleared to blank
// while typing, validates each keystroke, and pushes valid values to `commit`
// debounced by PREVIEW_DEBOUNCE_MS (used by the pattern overlays, whose live
// preview follows the committed store value).  Reports its validity up via
// `onValidChange` so the parent can disable Confirm while any field is blank /
// invalid.  Re-seeds from `storeValue` only when it changes from the OUTSIDE
// (tool open / edit), not when our own debounced commit echoes back.
export function DebouncedNumberField({
  storeValue,
  commit,
  validate,
  onValidChange,
  style,
  ...rest
}) {
  const [raw, setRaw] = useState(() => fmt(storeValue));
  const lastCommitted = useRef(storeValue);
  const onValidRef = useRef(onValidChange);
  onValidRef.current = onValidChange;

  useEffect(() => {
    if (storeValue !== lastCommitted.current) {
      lastCommitted.current = storeValue;
      setRaw(fmt(storeValue));
    }
  }, [storeValue]);

  const num = raw.trim() === "" ? NaN : Number(raw);
  const valid = validate(num);

  useEffect(() => {
    if (onValidRef.current) onValidRef.current(valid);
  }, [valid]);
  // A removed field (tool closed / mode switched) must not keep Confirm
  // disabled, so report "valid" on unmount.
  useEffect(
    () => () => {
      if (onValidRef.current) onValidRef.current(true);
    },
    [],
  );

  const commitRef = useRef(commit);
  commitRef.current = commit;
  const numRef = useRef(num);
  numRef.current = num;
  const flush = () => {
    if (!validate(numRef.current)) return;
    lastCommitted.current = numRef.current;
    commitRef.current(numRef.current);
  };
  useEffect(() => {
    if (!valid) return;
    const t = setTimeout(flush, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, valid]);

  return (
    <input
      type="number"
      value={raw}
      onChange={(e) => setRaw(e.target.value)}
      // Commit immediately when focus leaves (eg the user clicks Confirm) so a
      // fast type-then-confirm doesn't race the debounce and use a stale value.
      onBlur={flush}
      style={{
        ...style,
        border: `1px solid ${valid ? "var(--border-color)" : "#e87575"}`,
      }}
      {...rest}
    />
  );
}
