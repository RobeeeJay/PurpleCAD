// Tiny formula language for variable-backed dimensions and extrusion lengths.
//
// Grammar (recursive descent):
//   expr   := term (('+' | '-') term)*
//   term   := factor (('*' | '/') factor)*
//   factor := '-' factor | '(' expr ')' | number | identifier
//
// Identifiers reference other variables; cycles are detected and produce NaN.
// All values in the system are stored as strings (e.g. "10", "width * 2") so
// the same evaluator handles both bare numbers and formulas.
//
// Arithmetic runs through decimal.js so user-entered maths is exact in decimal
// (e.g. 0.1 + 0.2 = 0.3, not 0.30000000000000004).  Values flow as `Decimal`
// internally and are converted back to a JS number only at the public return
// (the geometry / three.js / OCC layers all consume doubles).

import Decimal from "decimal.js";

const D_NAN = new Decimal(NaN);

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n") {
      i++;
      continue;
    }
    if ("+-*/()".includes(c)) {
      tokens.push({ type: c });
      i++;
      continue;
    }
    if ((c >= "0" && c <= "9") || c === ".") {
      let j = i;
      while (
        j < src.length &&
        ((src[j] >= "0" && src[j] <= "9") || src[j] === ".")
      )
        j++;
      // Keep the raw literal string so decimal.js parses it exactly.
      tokens.push({ type: "num", value: src.slice(i, j) });
      i = j;
      continue;
    }
    if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_") {
      let j = i;
      while (
        j < src.length &&
        ((src[j] >= "a" && src[j] <= "z") ||
          (src[j] >= "A" && src[j] <= "Z") ||
          (src[j] >= "0" && src[j] <= "9") ||
          src[j] === "_")
      )
        j++;
      tokens.push({ type: "ident", value: src.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`Unexpected character "${c}" at position ${i}`);
  }
  return tokens;
}

function parseExpr(tokens, pos, evalIdent) {
  // All `value`s below are decimal.js Decimals.
  const parseFactor = (p) => {
    const t = tokens[p];
    if (!t) throw new Error("Unexpected end of expression");
    if (t.type === "-") {
      const inner = parseFactor(p + 1);
      return { value: inner.value.neg(), next: inner.next };
    }
    if (t.type === "+") return parseFactor(p + 1);
    if (t.type === "(") {
      const inner = parseExprAt(p + 1);
      if (tokens[inner.next]?.type !== ")")
        throw new Error("Missing closing parenthesis");
      return { value: inner.value, next: inner.next + 1 };
    }
    if (t.type === "num") return { value: new Decimal(t.value), next: p + 1 };
    if (t.type === "ident") return { value: evalIdent(t.value), next: p + 1 };
    throw new Error(`Unexpected token "${t.type}"`);
  };

  const parseTerm = (p) => {
    let { value, next } = parseFactor(p);
    while (tokens[next]?.type === "*" || tokens[next]?.type === "/") {
      const op = tokens[next].type;
      const rhs = parseFactor(next + 1);
      value = op === "*" ? value.times(rhs.value) : value.div(rhs.value);
      next = rhs.next;
    }
    return { value, next };
  };

  const parseExprAt = (p) => {
    let { value, next } = parseTerm(p);
    while (tokens[next]?.type === "+" || tokens[next]?.type === "-") {
      const op = tokens[next].type;
      const rhs = parseTerm(next + 1);
      value = op === "+" ? value.plus(rhs.value) : value.minus(rhs.value);
      next = rhs.next;
    }
    return { value, next };
  };

  return parseExprAt(pos);
}

// Evaluate a formula string. `variables` is a Map<name, formulaString> (or a
// plain object); references resolve recursively, and cycles return NaN.
// Returns a number; NaN signals "unevaluable" so callers can fall back.
export function evaluateFormula(formula, variables = {}) {
  if (formula == null) return NaN;
  if (typeof formula === "number") return formula;
  const src = String(formula).trim();
  if (src === "") return NaN;
  // Fast path: bare numeric literal (covers most stored values).
  const asNum = Number(src);
  if (!Number.isNaN(asNum) && /^-?\d+(\.\d+)?$/.test(src)) return asNum;

  const lookup =
    variables instanceof Map ? (n) => variables.get(n) : (n) => variables[n];

  const stack = new Set();
  const cache = new Map(); // name -> Decimal
  const evalIdent = (name) => {
    if (cache.has(name)) return cache.get(name);
    if (stack.has(name)) {
      cache.set(name, D_NAN);
      return D_NAN;
    }
    const raw = lookup(name);
    if (raw == null || String(raw).trim() === "") {
      cache.set(name, D_NAN);
      return D_NAN;
    }
    stack.add(name);
    let result;
    try {
      const innerTokens = tokenize(String(raw));
      const parsed = parseExpr(innerTokens, 0, evalIdent);
      result = parsed.next !== innerTokens.length ? D_NAN : parsed.value;
    } catch {
      result = D_NAN;
    }
    stack.delete(name);
    cache.set(name, result);
    return result;
  };

  try {
    const tokens = tokenize(src);
    const parsed = parseExpr(tokens, 0, evalIdent);
    if (parsed.next !== tokens.length) return NaN;
    return parsed.value.toNumber();
  } catch {
    return NaN;
  }
}

// Build a Map<name, formula> from an array of { name, formula } entries.
// Duplicate names: later entries win.
export function variablesToMap(variables) {
  const m = new Map();
  for (const v of variables || []) {
    if (v && typeof v.name === "string" && v.name) m.set(v.name, v.formula);
  }
  return m;
}

// Whether a stored dimension value is a formula / variable reference rather
// than a bare number.  A bare-number STRING ("10.5") is not a formula -- it is
// how the older documents stored plain values.
export function isFormulaValue(v) {
  return typeof v === "string" && !/^-?\d+(\.\d+)?$/.test(v.trim());
}

// A circle's dimension is stored as its RADIUS (centre to edge) but shown and
// typed as its DIAMETER.  These convert the formula text both ways, and are
// exact inverses of each other on anything they produced, so re-opening and
// re-confirming a value never piles up "* 2" and "/ 2" around it.
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

// True when the whole string is one bracketed group: "(a + b)" but not
// "(a) + (b)".
function isWrapped(s) {
  if (!s.startsWith("(") || !s.endsWith(")")) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    if (depth === 0 && i < s.length - 1) return false;
  }
  return depth === 0;
}

// A number, a bare variable name, or one bracketed group: safe to multiply or
// divide without adding brackets.
const isAtom = (s) =>
  NUMBER.test(s) || /^[A-Za-z_]\w*$/.test(s) || isWrapped(s);
const group = (s) => (isAtom(s) ? s : `(${s})`);
const unwrap = (s) => (isWrapped(s) ? s.slice(1, -1).trim() : s);

export function radiusToDiameterFormula(radius) {
  const s = String(radius).trim();
  if (NUMBER.test(s)) return new Decimal(s).times(2).toString();
  const halved = s.match(/^(.+?)\s*\/\s*2$/);
  if (halved && isAtom(halved[1].trim())) return unwrap(halved[1].trim());
  return `2 * ${group(s)}`;
}

export function diameterToRadiusFormula(diameter) {
  const s = String(diameter).trim();
  if (NUMBER.test(s)) return new Decimal(s).dividedBy(2).toString();
  const doubled = s.match(/^2\s*\*\s*(.+)$/);
  if (doubled && isAtom(doubled[1].trim())) return unwrap(doubled[1].trim());
  return `${group(s)} / 2`;
}
