// The agent API's command registry: every command declares its name, what it
// does and the shape of its arguments, and is called through one door.
//
// That declaration is the single source of truth. The MCP shim lists these and
// registers them as tools, the e2e suite drives them through window.__api, and
// nothing describes a command twice.

export class ApiError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

const commands = new Map();

export function defineCommand({ name, description, input = {}, run }) {
  if (commands.has(name))
    throw new Error(`Command "${name}" is defined twice.`);
  commands.set(name, { name, description, input, run });
}

export const listCommands = () =>
  [...commands.values()].map(({ name, description, input }) => ({
    name,
    description,
    inputSchema: {
      type: "object",
      properties: input.properties ?? {},
      required: input.required ?? [],
      additionalProperties: false,
    },
  }));

const is = {
  number: (v) => typeof v === "number" && Number.isFinite(v),
  integer: (v) => Number.isInteger(v),
  string: (v) => typeof v === "string",
  boolean: (v) => typeof v === "boolean",
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === "object" && !Array.isArray(v),
};

function check(value, spec, where) {
  const types = [].concat(spec.type ?? []);
  if (types.length && !types.some((t) => is[t]?.(value)))
    throw new ApiError("BAD_ARGS", `${where} must be ${types.join(" or ")}.`, {
      got: Array.isArray(value) ? "array" : typeof value,
    });
  if (spec.enum && !spec.enum.includes(value))
    throw new ApiError(
      "BAD_ARGS",
      `${where} must be one of: ${spec.enum.join(", ")}.`,
      { got: value },
    );
  if (typeof value === "number") {
    if (spec.minimum !== undefined && value < spec.minimum)
      throw new ApiError(
        "BAD_ARGS",
        `${where} must be at least ${spec.minimum}.`,
      );
    if (spec.maximum !== undefined && value > spec.maximum)
      throw new ApiError(
        "BAD_ARGS",
        `${where} must be at most ${spec.maximum}.`,
      );
  }
  if (Array.isArray(value) && spec.items)
    value.forEach((v, i) => check(v, spec.items, `${where}[${i}]`));
}

// Arguments are checked against the declared schema before a command runs, so
// a command body can trust its inputs and an agent gets told exactly which
// argument was wrong rather than a stack trace from somewhere inside.
export function validate(args, input, name) {
  if (!is.object(args))
    throw new ApiError(
      "BAD_ARGS",
      `${name} takes an object of named arguments.`,
    );
  const props = input.properties ?? {};
  for (const key of input.required ?? [])
    if (args[key] === undefined)
      throw new ApiError("BAD_ARGS", `${name}: "${key}" is required.`);
  for (const [key, value] of Object.entries(args)) {
    const spec = props[key];
    if (!spec)
      throw new ApiError("BAD_ARGS", `${name}: unknown argument "${key}".`, {
        accepted: Object.keys(props),
      });
    check(value, spec, `${name}.${key}`);
  }
  return args;
}

// Never throws: every outcome, including a bug, comes back as a result an
// agent can read. A thrown error would reach it as a transport failure with
// the reason lost.
export async function callCommand(name, args = {}) {
  try {
    const cmd = commands.get(name);
    if (!cmd)
      throw new ApiError("UNKNOWN_COMMAND", `No command called "${name}".`, {
        available: [...commands.keys()],
      });
    const result = await cmd.run(validate(args ?? {}, cmd.input, name));
    return { ok: true, result };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.toJSON() };
    return {
      ok: false,
      error: { code: "INTERNAL", message: err?.message ?? String(err) },
    };
  }
}
