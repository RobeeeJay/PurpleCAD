import Foundation
import JavaScriptCore

/// Runs the OCC ops in a JavaScriptCore context holding the unchanged
/// electron/occ-bridge.cjs -- the job the Electron OCC worker does on the
/// desktop.  One thread, because the shape store and OCC's own globals are
/// not thread-safe, and because OCC's fault-to-exception setup (occjs::Init)
/// is made on the thread that runs the ops.
final class OccHost {
  typealias Reply = (_ result: String?, _ error: String?) -> Void

  private var script: ScriptThread!
  /// The int32 a running op polls; set from the main thread to abort it.
  private let cancelFlag = UnsafeMutablePointer<Int32>.allocate(capacity: 1)

  init(bridgeSource: String, scripts: [String]) {
    cancelFlag.initialize(to: 0)
    let flag = cancelFlag
    // OCC's algorithms recurse deeply; a secondary thread's default stack is
    // 512 KB.  Node gives its workers 4 MB; this leaves room above that.
    script = ScriptThread(name: "occ", stackSize: 16 << 20) { context in
      let addon = OccMakeAddon(context.jsGlobalContextRef)
      context.setObject(JSValue(jsValueRef: addon, in: context),
                        forKeyedSubscript: "__occ" as NSString)
      OccSetCancelFlag(flag)
      context.setObject(bridgeSource, forKeyedSubscript: "__bridgeSource" as NSString)
    }
    script.enqueue { self.script.evaluate(scripts) }
  }

  /// Runs `op` with an encoded payload; `reply` is called on the main thread.
  func call(op: String, payload: String, reply: @escaping Reply) {
    script.enqueue {
      // Clear a cancel left from an earlier op: this thread is between ops.
      self.cancelFlag.pointee = 0
      let started = Date()
      let (result, error) = self.script.call("__invoke", [op, payload])
      let ms = Int(Date().timeIntervalSince(started) * 1000)
      Log.line("[OCC-native] \(op) \(error == nil ? "" : "FAILED ")\(ms)ms")
      DispatchQueue.main.async { reply(result, error) }
    }
  }

  /// Aborts the running op at its next checkpoint (see "OCC cancellation" in
  /// CLAUDE.md).  Called from the main thread while the OCC thread is busy.
  func cancel() {
    cancelFlag.pointee = 1
  }
}

/// Unbuffered lines on stdout, which `simctl launch --console-pty` relays,
/// and in Documents/console.log, started afresh each launch: on an iPad,
/// `devicectl ... --console` relayed none of the app's stdout (it did for the
/// Phase 0 spike, which never started UIKit), so the smoke run's report is
/// copied off the device instead (README.md).
enum Log {
  private static let file: FileHandle? = {
    let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("console.log")
    FileManager.default.createFile(atPath: url.path, contents: nil)
    return try? FileHandle(forWritingTo: url)
  }()
  private static let lock = NSLock()

  static func line(_ s: String) {
    lock.lock()
    defer { lock.unlock() }
    fputs(s + "\n", stdout)
    fflush(stdout)
    file?.write(Data((s + "\n").utf8))
  }
}
