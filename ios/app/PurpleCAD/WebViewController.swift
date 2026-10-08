import UIKit
import WebKit

/// Hosts the existing renderer in a WKWebView and answers its
/// window.electronAPI (js/electron-shim.js) the way Electron's main process
/// does: OCC ops go to the OCC thread, links to Safari.
final class WebViewController: UIViewController, WKScriptMessageHandler,
  WKScriptMessageHandlerWithReply
{
  private var webView: WKWebView!
  private var occ: OccHost!
  private let smoke = ProcessInfo.processInfo.arguments.contains("--smoke")

  override func loadView() {
    let res = Bundle.main.resourceURL!
    let script = { (name: String) in
      try! String(contentsOf: res.appendingPathComponent("js/\(name)"), encoding: .utf8)
    }
    occ = OccHost(
      bridgeSource: try! String(
        contentsOf: res.appendingPathComponent("occ/occ-bridge.cjs"), encoding: .utf8),
      scripts: [script("codec.js"), script("occ-host.js")])

    let config = WKWebViewConfiguration()
    config.setURLSchemeHandler(
      AppSchemeHandler(root: res.appendingPathComponent("web")), forURLScheme: "app")
    let content = config.userContentController
    content.addScriptMessageHandler(self, contentWorld: .page, name: "occ")
    content.add(self, name: "occCancel")
    content.add(self, name: "openExternal")
    for name in ["codec.js", "electron-shim.js"] {
      content.addUserScript(
        WKUserScript(source: script(name), injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    if smoke {
      content.add(self, name: "smoke")
      content.addUserScript(
        WKUserScript(source: script("smoke.js"), injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    }

    webView = WKWebView(frame: .zero, configuration: config)
    // Safari's Develop menu can attach to the page (iOS 16.4+).
    webView.isInspectable = true
    view = webView
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    webView.load(URLRequest(url: URL(string: "app://local/index.html")!))
  }

  // electronAPI.invokeOcc: the page awaits the reply.
  func userContentController(
    _ controller: WKUserContentController, didReceive message: WKScriptMessage,
    replyHandler: @escaping (Any?, String?) -> Void
  ) {
    guard let body = message.body as? [String: Any], let op = body["op"] as? String,
      let payload = body["payload"] as? String
    else {
      replyHandler(nil, "malformed OCC request")
      return
    }
    occ.call(op: op, payload: payload) { result, error in replyHandler(result, error) }
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
