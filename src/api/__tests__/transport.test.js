// The socket between an agent and the app. Checked with a real socket and a
// stand-in for the renderer, since what matters here is the wire: replies
// matched to the right request, failures reported rather than dropped, and a
// socket nobody else can open.
import { afterEach, describe, it, expect } from "vitest";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { AppConnection } from "../../../mcp/socketClient.mjs";

const require = createRequire(import.meta.url);
const { startApiServer } = require("../../../electron/apiServer.cjs");

const cleanups = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

const tempSocket = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pcad-api-"));
  cleanups.push(async () => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "api.sock");
};

const serve = async (invoke, socketPath = tempSocket()) => {
  const server = await startApiServer({ socketPath, invoke });
  if (server) cleanups.push(() => server.close());
  return server;
};

const connect = (socketPath) => {
  const c = new AppConnection(socketPath);
  cleanups.push(async () => c.close());
  return c;
};

// One raw exchange, for the malformed requests a well-behaved client never sends.
const raw = (socketPath, line) =>
  new Promise((resolve, reject) => {
    const s = net.connect(socketPath, () => s.write(line));
    s.setEncoding("utf8");
    let got = "";
    s.on("data", (d) => {
      got += d;
      if (got.includes("\n")) {
        s.destroy();
        resolve(JSON.parse(got.split("\n")[0]));
      }
    });
    s.on("error", reject);
  });

describe("the API socket", () => {
  it("answers list and call, with the app's reply inside result", async () => {
    const server = await serve(async (method, params) =>
      method === "list"
        ? [{ name: "body.list" }]
        : { ok: true, result: { echoed: params } },
    );
    const c = connect(server.socketPath);
    expect(await c.request("list")).toEqual([{ name: "body.list" }]);
    expect(
      await c.request("call", { name: "body.list", args: { a: 1 } }),
    ).toEqual({
      ok: true,
      result: { echoed: { name: "body.list", args: { a: 1 } } },
    });
  });

  it("keeps concurrent replies apart by id", async () => {
    // The first request answers LAST, so a reply matched by order rather than
    // by id would hand each caller the other's result.  Both are also the
    // client's FIRST requests, which is what once opened two connections and
    // left one hanging open -- this test then never finished tearing down.
    const server = await serve(
      (_m, { args }) =>
        new Promise((r) => setTimeout(() => r(args.n), args.wait)),
    );
    const c = connect(server.socketPath);
    const [slow, fast] = await Promise.all([
      c.request("call", { args: { n: "slow", wait: 80 } }),
      c.request("call", { args: { n: "fast", wait: 5 } }),
    ]);
    expect([slow, fast]).toEqual(["slow", "fast"]);
  });

  it("reports a failure of the app as an error with its code", async () => {
    const server = await serve(async () => {
      throw Object.assign(new Error("Still starting."), {
        code: "APP_NOT_READY",
      });
    });
    await expect(
      connect(server.socketPath).request("list"),
    ).rejects.toMatchObject({
      code: "APP_NOT_READY",
      message: "Still starting.",
    });
  });

  it("rejects a line that is not JSON, and a method it does not know", async () => {
    const server = await serve(async () => null);
    expect((await raw(server.socketPath, "not json\n")).error.code).toBe(
      "PARSE_ERROR",
    );
    expect(
      (await raw(server.socketPath, '{"id":7,"method":"delete"}\n')).error,
    ).toMatchObject({ code: "UNKNOWN_METHOD" });
  });

  it.skipIf(process.platform === "win32")(
    "creates its socket readable by its owner only",
    async () => {
      const server = await serve(async () => null);
      expect(fs.statSync(server.socketPath).mode & 0o777).toBe(0o600);
    },
  );

  it("clears a socket file left behind by a crash", async () => {
    const socketPath = tempSocket();
    fs.writeFileSync(socketPath, ""); // nothing listening behind it
    const server = await serve(async () => "fresh", socketPath);
    expect(server).not.toBeNull();
    expect(await connect(socketPath).request("list")).toBe("fresh");
  });

  it("will not take over a socket another running app is serving", async () => {
    const first = await serve(async () => "first");
    const second = await startApiServer({
      socketPath: first.socketPath,
      invoke: async () => "second",
    });
    expect(second).toBeNull();
    expect(await connect(first.socketPath).request("list")).toBe("first");
  });

  it("removes its socket file when it closes", async () => {
    const socketPath = tempSocket();
    const server = await startApiServer({
      socketPath,
      invoke: async () => null,
    });
    await server.close();
    expect(fs.existsSync(socketPath)).toBe(false);
  });
});

describe("the shim's connection", () => {
  it("says PurpleCAD is not running, and where it looked", async () => {
    const missing = tempSocket();
    await expect(connect(missing).request("list")).rejects.toMatchObject({
      code: "APP_NOT_RUNNING",
      message: expect.stringContaining(missing),
    });
  });

  it("fails what is pending if the app goes away mid-request", async () => {
    // The app never answers, then shuts down: the server must hang up rather
    // than wait for the client, and the client must fail the request rather
    // than wait for a reply that is not coming.
    const server = await serve(() => new Promise(() => {}));
    const c = connect(server.socketPath);
    const pending = c.request("call", { name: "view.render" });
    await new Promise((r) => setTimeout(r, 30));
    await server.close();
    await expect(pending).rejects.toMatchObject({ code: "APP_DISCONNECTED" });
  });
});
