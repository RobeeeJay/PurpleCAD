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
      tokens.push({ type: "num", value: parseFloat(src.slice(i, j)) });
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
  const parseFactor = (p) => {
    const t = tokens[p];
    if (!t) throw new Error("Unexpected end of expression");
    if (t.type === "-") {
      const inner = parseFactor(p + 1);
      return { value: -inner.value, next: inner.next };
    }
    if (t.type === "+") return parseFactor(p + 1);
    if (t.type === "(") {
      const inner = parseExprAt(p + 1);
      if (tokens[inner.next]?.type !== ")")
        throw new Error("Missing closing parenthesis");
      return { value: inner.value, next: inner.next + 1 };
    }
    if (t.type === "num") return { value: t.value, next: p + 1 };
    if (t.type === "ident") return { value: evalIdent(t.value), next: p + 1 };
    throw new Error(`Unexpected token "${t.type}"`);
  };

  const parseTerm = (p) => {
    let { value, next } = parseFactor(p);
    while (tokens[next]?.type === "*" || tokens[next]?.type === "/") {
      const op = tokens[next].type;
      const rhs = parseFactor(next + 1);
      value = op === "*" ? value * rhs.value : value / rhs.value;
      next = rhs.next;
    }
    return { value, next };
  };

  const parseExprAt = (p) => {
    let { value, next } = parseTerm(p);
    while (tokens[next]?.type === "+" || tokens[next]?.type === "-") {
      const op = tokens[next].type;
      const rhs = parseTerm(next + 1);
      value = op === "+" ? value + rhs.value : value - rhs.value;
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
  const cache = new Map();
  const evalIdent = (name) => {
    if (cache.has(name)) return cache.get(name);
    if (stack.has(name)) {
      cache.set(name, NaN);
      return NaN;
    }
    const raw = lookup(name);
    if (raw == null || String(raw).trim() === "") {
      cache.set(name, NaN);
      return NaN;
    }
    stack.add(name);
    let result;
    try {
      const innerTokens = tokenize(String(raw));
      const parsed = parseExpr(innerTokens, 0, evalIdent);
      if (parsed.next !== innerTokens.length) result = NaN;
      else result = parsed.value;
    } catch {
      result = NaN;
    }
    stack.delete(name);
    cache.set(name, result);
    return result;
  };

  try {
    const tokens = tokenize(src);
    const parsed = parseExpr(tokens, 0, evalIdent);
    if (parsed.next !== tokens.length) return NaN;
    return parsed.value;
  } catch {
    return NaN;
  }
}

// Convenience: evaluate with a fallback when the result is NaN/invalid.
export function evaluateFormulaOr(formula, variables, fallback) {
  const v = evaluateFormula(formula, variables);
  return Number.isFinite(v) ? v : fallback;
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
