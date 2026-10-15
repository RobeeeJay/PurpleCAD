import { useStore } from "../../store";
import { evaluateFormula, variablesToMap } from "../../utils/formulas.js";
import { ApiError, defineCommand } from "../registry.js";
import { waitForSettled } from "../settle.js";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const valueOf = (formula, map) => {
  try {
    const v = evaluateFormula(formula, map);
    return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null;
  } catch {
    return null;
  }
};

const listed = (variables) => {
  const map = variablesToMap(variables);
  return variables.map(({ name, formula }) => ({
    name,
    formula,
    valueMm: valueOf(formula, map),
  }));
};

defineCommand({
  name: "variables.set",
  description:
    'Define or change named dimensions. Each entry is { name, value } with value in mm, or { name, formula } where the formula may use + - * / ( ) and other variable names, e.g. "Width / 2 - Wall". Existing variables of the same name are replaced; the rest are kept. Sketches and features that use a variable rebuild before this returns.',
  input: {
    properties: {
      variables: {
        type: "array",
        items: { type: "object" },
        description: "[{ name, value } | { name, formula }]",
      },
    },
    required: ["variables"],
  },
  run: async ({ variables }) => {
    const next = [...useStore.getState().variables];
    variables.forEach((v, i) => {
      if (!IDENTIFIER.test(v?.name ?? ""))
        throw new ApiError(
          "BAD_ARGS",
          `variables[${i}].name must be an identifier: letters, digits and underscores, not starting with a digit.`,
          { got: v?.name },
        );
      const hasValue = typeof v.value === "number" && Number.isFinite(v.value);
      const hasFormula =
        typeof v.formula === "string" && v.formula.trim() !== "";
      if (hasValue === hasFormula)
        throw new ApiError(
          "BAD_ARGS",
          `variables[${i}] ("${v.name}") needs exactly one of value (a number in mm) or formula.`,
        );
      const formula = hasFormula ? v.formula : String(v.value);
      const at = next.findIndex((x) => x.name === v.name);
      if (at >= 0) next[at] = { ...next[at], formula };
      else next.push({ name: v.name, formula });
    });
    useStore.getState().setVariables(next);
    await waitForSettled();
    const s = useStore.getState();
    const list = listed(s.variables);
    const unresolved = list.filter((v) => v.valueMm === null);
    return {
      variables: list,
      ...(unresolved.length
        ? { unresolved: unresolved.map((v) => v.name) }
        : {}),
      // Dimensions whose variable now asks for something the rest of their
      // sketch will not allow; the sketch was left as it was.
      conflictingDimensions: s.dimensionConflicts?.size ?? 0,
    };
  },
});

defineCommand({
  name: "variables.list",
  description:
    "Every document variable, with its formula and its current value in mm.",
  run: async () => ({ variables: listed(useStore.getState().variables) }),
});
