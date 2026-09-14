// The shim's side of the socket a running PurpleCAD listens on
// (electron/apiServer.cjs): newline-delimited JSON, requests matched to
// replies by id, connecting lazily and again after the app restarts.

import net from "node:net";
import os from "node:os";
import path from "node:path";

// Where PurpleCAD puts the socket by default: its Electron userData directory,
// which is appData/<app name>. PURPLECAD_API_SOCKET overrides it -- the e2e
// suite gives each launch its own.
export function defaultSocketPath() {
  const home = os.homedir();
  const appData =
    process.platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : (process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"));
  return path.join(appData, "PurpleCAD", "purplecad-api.sock");
}

const failure = (code, message) => Object.assign(new Error(message), { code });

export class AppConnection {
  constructor(socketPath) {
    this.socketPath = socketPath;
    this.conn = null;
    this.pending = new Map();
    this.seq = 0;
    this.buffered = "";
  }

  connect() {
    if (this.conn && !this.conn.destroyed) return Promise.resolve();
    // One attempt at a time: two requests made together would otherwise each
    // open a socket, and the one left unused stays open for good -- which kept
    // the app's server waiting on it at shutdown.
    this.connecting ??= new Promise((resolve, reject) => {
      const conn = net.connect(this.socketPath);
      conn.setEncoding("utf8");
      conn.once("connect", () => {
        this.connecting = null;
        this.conn = conn;
        // Later errors surface through "close", which fails what is pending.
        conn.on("error", () => {});
        resolve();
      });
      conn.once("error", (err) => {
        this.connecting = null;
        reject(
          failure(
            "APP_NOT_RUNNING",
            `PurpleCAD is not running, or its agent API is off: nothing is listening on ${this.socketPath} (${err.code}). Start PurpleCAD, then try again.`,
          ),
        );
      });
      conn.on("data", (chunk) => this.onData(chunk));
      conn.on("close", () => {
        if (this.conn === conn) this.conn = null;
        for (const p of this.pending.values())
          p.reject(
            failure("APP_DISCONNECTED", "PurpleCAD closed the connection."),
          );
        this.pending.clear();
      });
    });
    return this.connecting;
  }

  onData(chunk) {
    this.buffered += chunk;
    let nl;
    while ((nl = this.buffered.indexOf("\n")) >= 0) {
      const line = this.buffered.slice(0, nl);
      this.buffered = this.buffered.slice(nl + 1);
      if (!line.trim()) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const pending = this.pending.get(message.id);
      if (!pending) continue;
      this.pending.delete(message.id);
      if (message.error)
        pending.reject(failure(message.error.code, message.error.message));
      else pending.resolve(message.result);
    }
  }

  async request(method, params = {}) {
    await this.connect();
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.conn.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }

  close() {
    this.conn?.destroy();
  }
}
