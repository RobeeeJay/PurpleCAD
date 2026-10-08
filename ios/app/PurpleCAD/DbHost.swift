import Foundation
import JavaScriptCore
import SQLite3

/// Persistence: the desktop's electron/kvStore.cjs, unchanged, in a
/// JavaScriptCore context on its own thread, over the system SQLite --
/// js/db-host.js gives it the slice of better-sqlite3 it uses, on top of the
/// `__sqlite` functions here.  Same schema, same queries, as the desktop's
/// database, so there is no second copy to keep in step.
final class DbHost {
  typealias Reply = (_ result: String?, _ error: String?) -> Void

  private var script: ScriptThread!

  init(file: URL, kvStoreSource: String, scripts: [String]) {
    script = ScriptThread(name: "db", stackSize: 4 << 20) { context in
      context.setObject(SQLiteJS.functions(in: context), forKeyedSubscript: "__sqlite" as NSString)
      context.setObject(kvStoreSource, forKeyedSubscript: "__kvStoreSource" as NSString)
      context.setObject(file.path, forKeyedSubscript: "__dbFile" as NSString)
    }
    script.enqueue { self.script.evaluate(scripts) }
  }

  /// bootstrap / loadProject / call, with an encoded payload; `reply` runs on
  /// the main thread.
  func request(method: String, payload: String, reply: @escaping Reply) {
    script.enqueue {
      let (result, error) = self.script.call("__db", [method, payload])
      if let error { Log.line("[db] \(method) failed: \(error)") }
      DispatchQueue.main.async { reply(result, error) }
    }
  }

  /// Calls `done` on the main thread once every request queued before it has
  /// been written.
  func barrier(_ done: @escaping () -> Void) {
    script.enqueue { DispatchQueue.main.async(execute: done) }
  }
}

/// The native half of the better-sqlite3 shim: handles for connections and
/// prepared statements, and rows as plain objects.  Runs on the db thread
/// only.  A failure becomes a JavaScript exception, as better-sqlite3 throws.
private enum SQLiteJS {
  // SQLITE_TRANSIENT: SQLite copies the bound text before the call returns.
  static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
  static var dbs: [Int: OpaquePointer] = [:]
  static var stmts: [Int: (stmt: OpaquePointer, db: OpaquePointer)] = [:]
  static var next = 1

  static func fail(_ message: String) -> Any? {
    let ctx = JSContext.current()!
    ctx.exception = JSValue(newErrorFromMessage: message, in: ctx)
    return nil
  }

  static func message(_ db: OpaquePointer?) -> String {
    db.map { String(cString: sqlite3_errmsg($0)) } ?? "SQLite error"
  }

  static func functions(in context: JSContext) -> JSValue {
    let fns = JSValue(newObjectIn: context)!
    let open: @convention(block) (String) -> Any? = { path in
      var db: OpaquePointer?
      guard sqlite3_open(path, &db) == SQLITE_OK, let db else {
        return fail("cannot open \(path): \(message(db))")
      }
      let h = next
      next += 1
      dbs[h] = db
      return h
    }
    let exec: @convention(block) (Int, String) -> Any? = { h, sql in
      guard let db = dbs[h] else { return fail("closed database") }
      return sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK ? true : fail(message(db))
    }
    let prepare: @convention(block) (Int, String) -> Any? = { h, sql in
      guard let db = dbs[h] else { return fail("closed database") }
      var stmt: OpaquePointer?
      guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK, let stmt else {
        return fail(message(db))
      }
      let s = next
      next += 1
      stmts[s] = (stmt, db)
      return s
    }
    // run(s, params) -> {changes, lastInsertRowid}; get -> row | null;
    // all -> [row].  `rows` is how many to read (0 = run, 1 = get, -1 = all).
    let step: @convention(block) (Int, JSValue, Int) -> Any? = { s, params, rows in
      guard let entry = stmts[s] else { return fail("finalized statement") }
      let (stmt, db) = (entry.stmt, entry.db)
      sqlite3_reset(stmt)
      sqlite3_clear_bindings(stmt)
      for (i, p) in (params.toArray() ?? []).enumerated() {
        let at = Int32(i + 1)
        switch p {
        case let n as NSNumber where CFGetTypeID(n) == CFBooleanGetTypeID():
          sqlite3_bind_int64(stmt, at, n.boolValue ? 1 : 0)
        case let n as NSNumber:
          let d = n.doubleValue
          // A whole number binds as INTEGER, as better-sqlite3 does.
          if d.rounded() == d && abs(d) < 9.0e15 {
            sqlite3_bind_int64(stmt, at, Int64(d))
          } else {
            sqlite3_bind_double(stmt, at, d)
          }
        case let t as String:
          sqlite3_bind_text(stmt, at, t, -1, transient)
        default:
          sqlite3_bind_null(stmt, at)
        }
      }
      var out: [[String: Any]] = []
      while true {
        let rc = sqlite3_step(stmt)
        if rc == SQLITE_DONE { break }
        guard rc == SQLITE_ROW else { return fail(message(db)) }
        if rows == 0 { continue }
        var row: [String: Any] = [:]
        for c in 0..<sqlite3_column_count(stmt) {
          let name = String(cString: sqlite3_column_name(stmt, c))
          switch sqlite3_column_type(stmt, c) {
          case SQLITE_INTEGER: row[name] = Double(sqlite3_column_int64(stmt, c))
          case SQLITE_FLOAT: row[name] = sqlite3_column_double(stmt, c)
          case SQLITE_TEXT: row[name] = String(cString: sqlite3_column_text(stmt, c))
          default: row[name] = NSNull()
          }
        }
        out.append(row)
        if rows == 1 { break }
      }
      sqlite3_reset(stmt)
      switch rows {
      case 0:
        return ["changes": Int(sqlite3_changes(db)),
                "lastInsertRowid": Double(sqlite3_last_insert_rowid(db))]
      case 1: return out.first ?? NSNull()
      default: return out
      }
    }
    let mkdir: @convention(block) (String) -> Void = { path in
      try? FileManager.default.createDirectory(
        atPath: path, withIntermediateDirectories: true)
    }
    fns.setObject(open, forKeyedSubscript: "open" as NSString)
    fns.setObject(exec, forKeyedSubscript: "exec" as NSString)
    fns.setObject(prepare, forKeyedSubscript: "prepare" as NSString)
    fns.setObject(step, forKeyedSubscript: "step" as NSString)
    fns.setObject(mkdir, forKeyedSubscript: "mkdir" as NSString)
    return fns
  }
}
