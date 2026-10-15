"use strict";
// The agent API's local transport: a Unix domain socket in the app's data
// directory, speaking newline-delimited JSON, forwarding each request to the
// renderer, where the commands run (src/api).
//
// A socket FILE rather than a TCP port: it is created 0600, so only the local
// user can open it, and nothing listens on the network -- a localhost port is
// reachable by every process on the machine, and by a web page doing DNS
// rebinding.
//
// One JSON object per line, each way:
//   -> { "id": 1, "method": "list" }
//   -> { "id": 2, "method": "call", "params": { "name": "...", "args": {} } }
//   <- { "id": 1, "result": <whatever the app returned> }
//   <- { "id": 2, "error": { "code": "...", "message": "..." } }
// A command's own refusal comes back inside `result` as { ok: false, error };
// the top-level `error` is only for failures of the transport itself.

const net = require("node:net");
const fs = require("node:fs");

// A render comes back as base64, so a reply line can be large; a request is
// small, and anything this big arriving is not a well-behaved client.
const MAX_REQUEST_BYTES = 8 * 1024 * 1024;

// Whether something is already listening on the socket.  A socket file left
// by a crash refuses the connection and can be cleared; a live one belongs to
// another PurpleCAD and must not be taken over.
function isLive(socketPath) {
  return new Promise((resolve) => {
    const probe = net.connect(socketPath);
    probe.once("connect", () => {
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => resolve(false));
  });
}

const send = (conn, message) => {
  if (!conn.destroyed) conn.write(JSON.stringify(message) + "\n");
};

async function handleLine(line, conn, invoke) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send(conn, {
      id: null,
      error: {
        code: "PARSE_ERROR",
        message: "Each line must be one JSON object.",
      },
    });
    return;
  }
  const { id = null, method, params } = message ?? {};
  if (method !== "list" && method !== "call") {
    send(conn, {
      id,
      error: {
        code: "UNKNOWN_METHOD",
        message: `Unknown method "${method}"; use "list" or "call".`,
      },
    });
    return;
  }
  try {
    send(conn, { id, result: await invoke(method, params ?? {}) });
  } catch (err) {
    send(conn, {
      id,
      error: { code: err.code ?? "APP_ERROR", message: err.message },
    });
  }
}

function handleConnection(conn, invoke) {
  conn.setEncoding("utf8");
  let buffered = "";
  conn.on("data", (chunk) => {
    buffered += chunk;
    let nl;
    while ((nl = buffered.indexOf("\n")) >= 0) {
      const line = buffered.slice(0, nl);
      buffered = buffered.slice(nl + 1);
      // Requests on one connection run concurrently; replies carry the id.
      if (line.trim()) void handleLine(line, conn, invoke);
    }
    if (buffered.length > MAX_REQUEST_BYTES) conn.destroy();
  });
  // A client that goes away mid-reply is not the server's problem.
  conn.on("error", () => {});
}

// Resolves to { socketPath, close } once listening, or to null when the socket
// is already owned by a live PurpleCAD.
async function startApiServer({ socketPath, invoke }) {
  if (fs.existsSync(socketPath)) {
    if (await isLive(socketPath)) return null;
    fs.unlinkSync(socketPath);
  }
  const connections = new Set();
  const server = net.createServer((conn) => {
    connections.add(conn);
    conn.on("close", () => connections.delete(conn));
    handleConnection(conn, invoke);
  });
  // Created with no group/other permissions from the first instant, rather
  // than chmod-ed afterwards and briefly open to anyone in between.
  const previousMask = process.umask(0o177);
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
  } finally {
    process.umask(previousMask);
  }
  fs.chmodSync(socketPath, 0o600);
  return {
    socketPath,
    close: () =>
      new Promise((resolve) => {
        server.close(() => {
          try {
            fs.unlinkSync(socketPath);
          } catch {
            // already gone
          }
          resolve();
        });
        // Hang up on connected clients rather than wait for them to leave: a
        // shim that stays connected would keep this waiting for good, and its
        // agent would learn the app had gone only when a request timed out.
        for (const conn of connections) conn.destroy();
      }),
  };
}

module.exports = { startApiServer };
