import UIKit
import WebKit

/// Hosts the existing renderer in a WKWebView and answers its
/// window.electronAPI (js/electron-shim.js) the way Electron's main process
/// does: OCC ops go to the OCC thread, links to Safari.
final class WebViewController: UIViewController, WKScriptMessageHandler,
  WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKDownloadDelegate
{
  private var webView: WKWebView!
  private var occ: OccHost!
  private var db: DbHost!
  /// Where each download in flight is being written.
  private var downloads: [ObjectIdentifier: URL] = [:]
  private let smokeReload = ProcessInfo.processInfo.arguments.contains("--smoke-reload")
  private lazy var smoke =
    smokeReload || ProcessInfo.processInfo.arguments.contains("--smoke")

  override func loadView() {
    let res = Bundle.main.resourceURL!
    let script = { (name: String) in
      try! String(contentsOf: res.appendingPathComponent("js/\(name)"), encoding: .utf8)
    }
    occ = OccHost(
      bridgeSource: try! String(
        contentsOf: res.appendingPathComponent("occ/occ-bridge.cjs"), encoding: .utf8),
      scripts: [script("codec.js"), script("occ-host.js")])
    let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    db = DbHost(
      file: support.appendingPathComponent("purplecad.db"),
      kvStoreSource: try! String(
        contentsOf: res.appendingPathComponent("occ/kvStore.cjs"), encoding: .utf8),
      scripts: [script("codec.js"), script("db-host.js")])

    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(
      AppSchemeHandler(root: res.appendingPathComponent("web")), forURLScheme: "app")
    let content = config.userContentController
    content.addScriptMessageHandler(self, contentWorld: .page, name: "occ")
    content.addScriptMessageHandler(self, contentWorld: .page, name: "db")
    content.add(self, name: "occCancel")
    content.add(self, name: "openExternal")
    for name in ["codec.js", "electron-shim.js"] {
      content.addUserScript(
        WKUserScript(source: script(name), injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    if smoke {
      content.add(self, name: "smoke")
      content.addUserScript(
        WKUserScript(
          source: "window.__smokeMode = \"\(smokeReload ? "reload" : "build")\";",
          injectionTime: .atDocumentStart, forMainFrameOnly: true))
      content.addUserScript(
        WKUserScript(source: script("smoke.js"), injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    }

    webView = WKWebView(frame: .zero, configuration: config)
    // Safari's Develop menu can attach to the page (iOS 16.4+).
    webView.isInspectable = true
    webView.navigationDelegate = self
    view = webView
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    webView.load(URLRequest(url: URL(string: "app://local/index.html")!))
  }

  // electronAPI.invokeOcc and the db* calls: the page awaits the reply.
  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage,
    replyHandler: @escaping (Any?, String?) -> Void
  ) {
    let body = message.body as? [String: Any] ?? [:]
    guard let payload = body["payload"] as? String else {
      replyHandler(nil, "malformed \(message.name) request")
      return
    }
    if message.name == "db", let method = body["method"] as? String {
      db.request(method: method, payload: payload) { replyHandler($0, $1) }
    } else if let op = body["op"] as? String {
      occ.call(op: op, payload: payload) { replyHandler($0, $1) }
    } else {
      replyHandler(nil, "malformed \(message.name) request")
    }
  }

  /// The app has gone to the background.  The page flushes its pending save
  /// on visibilitychange (src/store/db.js); this keeps the app running long
  /// enough for that write to arrive and reach the database.  Two seconds is
  /// generous for a message and an SQLite write, and well inside the time
  /// iOS grants a background task.
  func enteredBackground() {
    var task = UIBackgroundTaskIdentifier.invalid
    task = UIApplication.shared.beginBackgroundTask(withName: "save") {
      UIApplication.shared.endBackgroundTask(task)
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
      self.db.barrier {
        Log.line("[db] saved for the background")
        UIApplication.shared.endBackgroundTask(task)
      }
    }
  }

  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    switch message.name {
    case "occCancel":
      occ.cancel()
    case "openExternal":
      if let s = message.body as? String, let url = URL(string: s),
        url.scheme == "https" || url.scheme == "http"
      {
        UIApplication.shared.open(url)
      }
    case "smoke":
      smokeMessage(message.body as? [String: Any] ?? [:])
    default:
      break
    }
  }

  // ── Files ──────────────────────────────────────────────────────────────

  /// Opens a .pcad (from the Files app, or a share) as a new project, by the
  /// same path as the toolbar's Open (DocumentSection's openDocumentText).
  /// Waits for the toolbar, where that listener lives, so a document that
  /// launches the app still opens.
  func openDocument(url: URL) {
    let scoped = url.startAccessingSecurityScopedResource()
    defer { if scoped { url.stopAccessingSecurityScopedResource() } }
    guard let text = try? String(contentsOf: url, encoding: .utf8),
      let json = try? JSONSerialization.data(
        withJSONObject: ["name": url.lastPathComponent, "text": text]),
      let detail = String(data: json, encoding: .utf8)
    else {
      Log.line("[files] cannot read \(url.lastPathComponent)")
      return
    }
    Log.line("[files] opening \(url.lastPathComponent) (\(text.utf8.count) bytes)")
    webView.evaluateJavaScript("""
      (function open() {
        if (!document.querySelector(".toolbar")) return setTimeout(open, 100);
        window.dispatchEvent(new CustomEvent("purplecad:open-document", { detail: \(detail) }));
      })();
      """)
  }

  // The app window never navigates (CLAUDE.md, "Misc"): its own pages load,
  // a download is a download, and a web link goes to Safari.
  func webView(
    _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    if action.shouldPerformDownload { return decisionHandler(.download) }
    let url = action.request.url
    switch url?.scheme {
    case "app", "blob", "about":
      decisionHandler(.allow)
    case "http", "https":
      UIApplication.shared.open(url!)
      decisionHandler(.cancel)
    default:
      decisionHandler(.cancel)
    }
  }

  func webView(
    _ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload
  ) {
    download.delegate = self
  }

  func webView(
    _ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload
  ) {
    download.delegate = self
  }

  func download(
    _ download: WKDownload, decideDestinationUsing response: URLResponse,
    suggestedFilename: String, completionHandler: @escaping (URL?) -> Void
  ) {
    let dir = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let file = dir.appendingPathComponent(suggestedFilename)
    downloads[ObjectIdentifier(download)] = file
    completionHandler(file)
  }

  func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
    let file = downloads.removeValue(forKey: ObjectIdentifier(download))
    Log.line("[files] download of \(file?.lastPathComponent ?? "?") failed: \(error)")
  }

  /// A finished Save / Export: offered to the share sheet, whose "Save to
  /// Files" is how a .pcad, STL or STEP leaves the app.
  func downloadDidFinish(_ download: WKDownload) {
    guard let file = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
    let size = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? Int) ?? 0
    Log.line("[files] downloaded \(file.lastPathComponent) (\(size) bytes)")
    if smoke {
      // No one to tap the share sheet: hand the file back to the page, and
      // reopen a saved document the way the Files app would.
      webView.evaluateJavaScript(
        "window.__smokeDownloaded && window.__smokeDownloaded(\"\(file.lastPathComponent)\", \(size))")
      if file.pathExtension == "pcad" { openDocument(url: file) }
      return
    }
    let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
    share.popoverPresentationController?.sourceView = view
    // The Save / Export button sits at the left of the toolbar.
    share.popoverPresentationController?.sourceRect = CGRect(x: 280, y: 40, width: 1, height: 1)
    present(share, animated: true)
  }

  private func smokeMessage(_ m: [String: Any]) {
    if let line = m["log"] as? String { Log.line("[smoke] \(line)") }
    if let png = m["png"] as? String, let data = Data(base64Encoded: png) {
      let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("smoke-iso.png")
      try? data.write(to: file)
      Log.line("[smoke] wrote \(file.path)")
    }
    if m["done"] as? Bool == true {
      let ok = m["ok"] as? Bool == true
      Log.line("[smoke] \(ok ? "PASSED" : "FAILED"): \(m["summary"] as? String ?? "")")
      exit(ok ? 0 : 1)
    }
  }
}
