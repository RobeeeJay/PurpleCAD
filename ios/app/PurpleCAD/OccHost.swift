import Foundation
import JavaScriptCore

/// Runs the OCC ops on one dedicated thread, in a JavaScriptCore context
/// holding the unchanged electron/occ-bridge.cjs -- the job the Electron OCC
/// worker does on the desktop.  One thread, because the shape store and OCC's
/// own globals are not thread-safe, and because OCC's fault-to-exception
/// setup (occjs::Init) is made on the thread that runs the ops.
final class OccHost {
  typealias Reply = (_ result: String?, _ error: String?) -> Void

  private let lock = NSCondition()
  private var jobs: [() -> Void] = []
  private var context: JSContext!
  /// The int32 a running op polls; set from the main thread to abort it.
  private let cancelFlag = UnsafeMutablePointer<Int32>.allocate(capacity: 1)

  init(bridgeSource: String, scripts: [String]) {
    cancelFlag.initialize(to: 0)
    let thread = Thread { [unowned self] in self.runLoop() }
    thread.name = "occ"
    // OCC's algorithms recurse deeply; a secondary thread's default stack is
    // 512 KB.  Node gives its workers 4 MB; this leaves room above that.
    thread.stackSize = 16 << 20
    thread.qualityOfService = .userInitiated
    thread.start()
    enqueue { self.setUp(bridgeSource: bridgeSource, scripts: scripts) }
  }

  /// Runs `op` with an encoded payload; `reply` is called on the main thread.
  func call(op: String, payload: String, reply: @escaping Reply) {
    enqueue {
      // Clear a cancel left from an earlier op: this thread is between ops.
      self.cancelFlag.pointee = 0
      let started = Date()
      let fn = self.context.objectForKeyedSubscript("__invoke")!
      let result = fn.call(withArguments: [op, payload])
      var error: String?
      if let exc = self.context.exception {
        self.context.exception = nil
        error = exc.objectForKeyedSubscript("message")?.toString() ?? exc.toString()
      }
      let out = error == nil ? result?.toString() : nil
      let ms = Int(Date().timeIntervalSince(started) * 1000)
      Log.line("[OCC-native] \(op) \(error == nil ? "" : "FAILED ")\(ms)ms")
      DispatchQueue.main.async { reply(out, error) }
    }
  }

  /// Aborts the running op at its next checkpoint (see "OCC cancellation" in
  /// CLAUDE.md).  Called from the main thread while the OCC thread is busy.
  func cancel() {
    cancelFlag.pointee = 1
  }

  private func setUp(bridgeSource: String, scripts: [String]) {
    let context = JSContext(virtualMachine: JSVirtualMachine())!
    self.context = context
    let log: @convention(block) () -> Void = {
      let args = JSContext.currentArguments() as? [JSValue] ?? []
      Log.line("[occ] " + args.map { $0.toString() ?? "" }.joined(separator: " "))
    }
    let console = JSValue(newObjectIn: context)!
    for name in ["log", "warn", "error"] {
      console.setObject(log, forKeyedSubscript: name as NSString)
    }
    context.setObject(console, forKeyedSubscript: "console" as NSString)
    let addon = OccMakeAddon(context.jsGlobalContextRef)
    context.setObject(JSValue(jsValueRef: addon, in: context),
                      forKeyedSubscript: "__occ" as NSString)
    OccSetCancelFlag(cancelFlag)
    context.setObject(bridgeSource, forKeyedSubscript: "__bridgeSource" as NSString)
    for script in scripts {
      context.evaluateScript(script)
      if let exc = context.exception {
        Log.line("[occ] setup failed: \(exc)")
        context.exception = nil
      }
    }
  }

  private func enqueue(_ job: @escaping () -> Void) {
    lock.lock()
    jobs.append(job)
    lock.signal()
    lock.unlock()
  }

  private func runLoop() {
    while true {
      lock.lock()
      while jobs.isEmpty { lock.wait() }
      let job = jobs.removeFirst()
      lock.unlock()
      autoreleasepool { job() }
    }
  }
}

/// Unbuffered lines on stdout, which `devicectl ... --console` and
/// `simctl launch --console-pty` relay -- the smoke run's only channel out.
enum Log {
  static func line(_ s: String) {
    fputs(s + "\n", stdout)
    fflush(stdout)
  }
}
