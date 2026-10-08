import Foundation
import UniformTypeIdentifiers
import WebKit

/// Serves the renderer bundle (Vite's dist/, copied into the app as web/)
/// at app://local/.  A real scheme rather than file://, as on the desktop
/// (main.cjs registers app://): module scripts and module workers need a
/// same-origin URL and a JavaScript MIME type.
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
  private let root: URL

  init(root: URL) {
    self.root = root.standardizedFileURL
  }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    guard let url = task.request.url else { return }
    var path = url.path
    if path.isEmpty || path == "/" { path = "/index.html" }
    let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
    guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }
    let response = HTTPURLResponse(
      url: url, statusCode: 200, httpVersion: "HTTP/1.1",
      headerFields: [
        "Content-Type": Self.mimeType(file.pathExtension),
        "Content-Length": String(data.count),
      ])!
    task.didReceive(response)
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

  private static func mimeType(_ ext: String) -> String {
    switch ext {
    case "js", "mjs": return "text/javascript"
    case "html": return "text/html"
    case "css": return "text/css"
    case "json": return "application/json"
    case "wasm": return "application/wasm"
    default: return UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
    }
  }
}
