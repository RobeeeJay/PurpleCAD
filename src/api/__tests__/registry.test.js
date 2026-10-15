// The registry is the contract an agent sees: every failure has to come back
// as a readable result naming what was wrong, and nothing may escape as a
// throw, which would reach an MCP client as a transport error with the reason
// lost.
import { describe, it, expect } from "vitest";
import {
  ApiError,
  callCommand,
  defineCommand,
  listCommands,
} from "../registry.js";

defineCommand({
  name: "test.echo",
  description: "Hands its arguments back.",
  input: {
    properties: {
      n: { type: "integer", minimum: 0 },
      s: { type: "string", enum: ["a", "b"] },
      xs: { type: "array", items: { type: "number" } },
      v: { type: ["number", "string"] },
    },
    required: ["n"],
  },
  run: async (args) => args,
});
defineCommand({
  name: "test.refuses",
  run: async () => {
    throw new ApiError("NOPE", "Not today.", { why: "testing" });
  },
});
defineCommand({
  name: "test.bug",
  run: async () => {
    throw new Error("kaboom");
  },
});

const error = async (name, args) => {
  const r = await callCommand(name, args);
  expect(r.ok).toBe(false);
  return r.error;
};

describe("calling a command", () => {
  it("returns what the command returned", async () => {
    expect(await callCommand("test.echo", { n: 2, s: "a" })).toEqual({
      ok: true,
      result: { n: 2, s: "a" },
    });
  });

  it("names a missing required argument", async () => {
    const e = await error("test.echo", {});
    expect(e.code).toBe("BAD_ARGS");
    expect(e.message).toMatch(/"n" is required/);
  });

  it("rejects an argument it does not know, listing the ones it does", async () => {
    const e = await error("test.echo", { n: 1, m: 2 });
    expect(e.message).toMatch(/unknown argument "m"/);
    expect(e.details.accepted).toEqual(["n", "s", "xs", "v"]);
  });

  it("checks types, enums, bounds and array items", async () => {
    expect((await error("test.echo", { n: 1.5 })).message).toMatch(/integer/);
    expect((await error("test.echo", { n: 1, s: "c" })).message).toMatch(
      /one of: a, b/,
    );
    expect((await error("test.echo", { n: -1 })).message).toMatch(/at least 0/);
    expect((await error("test.echo", { n: 1, xs: [1, "2"] })).message).toMatch(
      /xs\[1\] must be number/,
    );
  });

  it("accepts either type of a union", async () => {
    expect((await callCommand("test.echo", { n: 0, v: 3 })).ok).toBe(true);
    expect((await callCommand("test.echo", { n: 0, v: "Width" })).ok).toBe(
      true,
    );
    expect((await error("test.echo", { n: 0, v: true })).code).toBe("BAD_ARGS");
  });

  it("says when there is no such command, and what there is", async () => {
    const e = await error("test.nothing", {});
    expect(e.code).toBe("UNKNOWN_COMMAND");
    expect(e.details.available).toContain("test.echo");
  });

  it("passes a command's own refusal through with its details", async () => {
    expect(await error("test.refuses", {})).toEqual({
      code: "NOPE",
      message: "Not today.",
      details: { why: "testing" },
    });
  });

  it("turns a bug into a result instead of throwing", async () => {
    await expect(callCommand("test.bug", {})).resolves.toEqual({
      ok: false,
      error: { code: "INTERNAL", message: "kaboom" },
    });
  });
});

describe("the command list", () => {
  it("describes each command with a closed JSON schema", () => {
    const echo = listCommands().find((c) => c.name === "test.echo");
    expect(echo.inputSchema).toEqual({
      type: "object",
      properties: expect.objectContaining({ n: expect.any(Object) }),
      required: ["n"],
      additionalProperties: false,
    });
  });

  it("will not let a command be defined twice", () => {
    expect(() =>
      defineCommand({ name: "test.echo", run: async () => null }),
    ).toThrow(/defined twice/);
  });
});
