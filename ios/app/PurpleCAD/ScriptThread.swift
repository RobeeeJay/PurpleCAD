import Foundation
import JavaScriptCore

/// A JavaScriptCore context with one thread of its own, running queued jobs
/// in order -- the shape of an Electron worker.  The OCC ops and the database
/// each get one, so a save never waits behind a long boolean.
final class ScriptThread {
  private let lock = NSCondition()
  private var jobs: [() -> Void] = []
  /// Valid on this thread only, once the first job (setUp) has run.
  private(set) var context: JSContext!

  init(name: String, stackSize: Int, setUp: @escaping (JSContext) -> Void) {
    let thread = Thread { [unowned self] in self.runLoop() }
    thread.name = name
    thread.stackSize = stackSize
    thread.qualityOfService = .userInitiated
    thread.start()
    enqueue {
      let context = JSContext(virtualMachine: JSVirtualMachine())!
      self.context = context
      let log: @convention(block) () -> Void = {
        let args = JSContext.currentArguments() as? [JSValue] ?? []
        Log.line("[\(name)] " + args.map { $0.toString() ?? "" }.joined(separator: " "))
      }
      let console = JSValue(newObjectIn: context)!
      for level in ["log", "warn", "error"] {
        console.setObject(log, forKeyedSubscript: level as NSString)
      }
      context.setObject(console, forKeyedSubscript: "console" as NSString)
      setUp(context)
    }
  }

  func enqueue(_ job: @escaping () -> Void) {
    lock.lock()
    jobs.append(job)
    lock.signal()
    lock.unlock()
  }

  /// Evaluates scripts in order, logging (not throwing) a failure.
  func evaluate(_ scripts: [String]) {
    for script in scripts {
      context.evaluateScript(script)
      if let exc = context.exception {
        Log.line("[\(Thread.current.name ?? "script")] setup failed: \(exc)")
        context.exception = nil
      }
    }
  }

  /// Calls global `fn` with string arguments; returns its string result, or
  /// the message of what it threw.
  func call(_ fn: String, _ args: [String]) -> (result: String?, error: String?) {
    let value = context.objectForKeyedSubscript(fn)!.call(withArguments: args)
    if let exc = context.exception {
      context.exception = nil
      return (nil, exc.objectForKeyedSubscript("message")?.toString() ?? exc.toString())
    }
    return (value?.toString(), nil)
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
