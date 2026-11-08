// A stand-in for what the Snappy window does, used only by apps/app/tools/macos/smoke.sh in CI.
//
//   webkit-probe locked|control <base-url-of-a-loopback-test-server>
//
// WHAT IT IS. A plain WKWebView (the system web view that Tauri's wry uses on macOS) that loads a tiny page from a custom
// URL scheme, tauri://localhost/, the way the real app does. It is NOT the Snappy app and not its code: it applies the same
// two WebKit hooks that wry applies for Snappy's on_navigation and on_new_window handlers (a navigation policy that cancels
// every address except the app's own, and a UI delegate that refuses every new window), and the same kind of content
// security policy. It answers two questions the real app cannot be asked on a CI runner:
//
//   1. Which web features the page needs exist under a custom-scheme origin: a secure context, Web Crypto (PBKDF2 and
//      AES-GCM, the vault's), Web Locks, Object.hasOwn, IndexedDB and a Worker made from a blob.
//   2. Does WebKit send the request for a blocked address BEFORE the delegate cancels it? (On Windows' WebView2 it did, which
//      is why the Windows shell needs an extra request filter.) The page tries every way to reach the test server: a link,
//      window.open, a form post, fetch, XMLHttpRequest, an image, an iframe, a WebSocket, sendBeacon, location.href and
//      location.replace. The shell script then counts what the server received.
//
// "locked" applies the delegates and the policy: the server should receive nothing. "control" applies neither: the server
// must then receive requests, which proves the test can see them. Printed lines: "api name=value", "refused ...", "page ...".
import Cocoa
import WebKit

guard CommandLine.arguments.count == 3, ["locked", "control"].contains(CommandLine.arguments[1]), let base = URL(string: CommandLine.arguments[2]), base.port != nil else {
    print("usage: webkit-probe locked|control http://127.0.0.1:PORT")
    exit(2)
}
let port: Int = base.port ?? 0
let locked = CommandLine.arguments[1] == "locked"
let baseText = base.absoluteString.hasSuffix("/") ? String(base.absoluteString.dropLast()) : base.absoluteString

let page = "<!doctype html><meta charset=\"utf-8\"><title>probe</title><body>probe</body>"
let policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; worker-src blob:; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'"

final class Pages: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        var headers = ["Content-Type": "text/html; charset=utf-8"]
        if locked { headers["Content-Security-Policy"] = policy }
        let data = page.data(using: .utf8)!
        let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class Probe: NSObject, WKNavigationDelegate, WKUIDelegate {
    var web: WKWebView!
    var window: NSWindow!

    func ownPage(_ url: URL) -> Bool {
        if url.scheme == "tauri" && url.host == "localhost" && url.port == nil { return true }
        if url.scheme == "blob" { return url.absoluteString.hasPrefix("blob:tauri://localhost/") }
        return false
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard locked else { decisionHandler(.allow); return }
        let url = navigationAction.request.url
        if let url = url, ownPage(url) {
            decisionHandler(.allow)
        } else {
            print("refused navigation: \(url?.absoluteString ?? "nil")")
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        print("refused new window: \(navigationAction.request.url?.absoluteString ?? "nil")")
        return nil
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let url = webView.url else { return }
        if !ownPage(url) {
            // Only the control run gets here: nothing stopped the page from leaving, and the test server answered.
            print("navigated away to: \(url.absoluteString)")
            if !locked { exit(0) }
            return
        }
        print("page loaded: \(url.absoluteString)")
        webView.evaluateJavaScript(script) { _, _ in }
        Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { _ in self.poll() }
    }

    var polls = 0
    func poll() {
        polls += 1
        web.evaluateJavaScript("window.__done === true ? JSON.stringify(window.__apis) : ''") { result, _ in
            if let text = result as? String, !text.isEmpty {
                self.report(text)
                exit(0)
            }
        }
        if polls > 50 {
            print("probe: the page did not finish in 25 seconds")
            exit(3)
        }
    }

    func report(_ json: String) {
        guard let data = json.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            print("probe: could not read the page's answer: \(json)")
            return
        }
        for key in object.keys.sorted() { print("api \(key)=\(object[key] ?? "")") }
    }

    let script = """
    (async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const r = {};
      r.origin = location.origin;
      r.isSecureContext = String(window.isSecureContext);
      r.userAgent = navigator.userAgent;
      r.cryptoSubtle = typeof (self.crypto && self.crypto.subtle);
      try {
        const enc = new TextEncoder();
        const material = await crypto.subtle.importKey("raw", enc.encode("passphrase"), "PBKDF2", false, ["deriveKey"]);
        const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt: new Uint8Array(16), iterations: 1000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode("hello"));
        const opened = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, sealed);
        r.pbkdf2AesGcmRoundTrip = new TextDecoder().decode(opened) === "hello" ? "ok" : "wrong text";
      } catch (e) { r.pbkdf2AesGcmRoundTrip = "error: " + e; }
      r.locks = typeof navigator.locks;
      try { r.locksRequest = await navigator.locks.request("probe", async () => "ok"); } catch (e) { r.locksRequest = "error: " + e; }
      r.objectHasOwn = typeof Object.hasOwn;
      r.indexedDB = await new Promise((done) => { try { const q = indexedDB.open("probe"); q.onsuccess = () => { q.result.close(); done("ok"); }; q.onerror = () => done("error: " + q.error); } catch (e) { done("error: " + e); } });
      r.blobWorker = await new Promise((done) => { try { const w = new Worker(URL.createObjectURL(new Blob(["postMessage('hi')"], { type: "text/javascript" }))); w.onmessage = (e) => done("ok: " + e.data); w.onerror = () => done("error"); setTimeout(() => done("timeout"), 4000); } catch (e) { done("error: " + e); } });
      const base = "\(baseText)";
      const attempts = [];
      const attempt = (name, fn) => { try { fn(); attempts.push(name + ":sent"); } catch (e) { attempts.push(name + ":threw"); } };
      attempt("windowOpen", () => window.open(base + "/window-open", "_blank"));
      attempt("linkBlank", () => { const a = document.createElement("a"); a.href = base + "/link-blank"; a.target = "_blank"; document.body.appendChild(a); a.click(); });
      attempt("linkSelf", () => { const a = document.createElement("a"); a.href = base + "/link-self"; document.body.appendChild(a); a.click(); });
      attempt("form", () => { const f = document.createElement("form"); f.method = "POST"; f.action = base + "/form"; document.body.appendChild(f); f.submit(); });
      attempt("fetch", () => { fetch(base + "/fetch", { mode: "no-cors" }).catch(() => {}); });
      attempt("xhr", () => { const x = new XMLHttpRequest(); x.open("GET", base + "/xhr"); x.send(); });
      attempt("image", () => { new Image().src = base + "/image.png"; });
      attempt("iframe", () => { const i = document.createElement("iframe"); i.src = base + "/iframe"; document.body.appendChild(i); });
      attempt("webSocket", () => { new WebSocket("ws://127.0.0.1:\(port)/websocket"); });
      attempt("beacon", () => { navigator.sendBeacon(base + "/beacon", "x"); });
      await sleep(1500);
      attempt("locationReplace", () => location.replace(base + "/location-replace"));
      await sleep(500);
      attempt("locationHref", () => { location.href = base + "/location-href"; });
      await sleep(1500);
      r.attempts = attempts.join(" ");
      window.__apis = r;
      window.__done = true;
    })();
    """

    func start() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(Pages(), forURLScheme: "tauri")
        web = WKWebView(frame: NSRect(x: 0, y: 0, width: 600, height: 400), configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        window = NSWindow(contentRect: NSRect(x: 100, y: 100, width: 600, height: 400), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = web
        window.makeKeyAndOrderFront(nil)
        web.load(URLRequest(url: URL(string: "tauri://localhost/")!))
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
let probe = Probe()
probe.start()
// A hard stop, so a hung page cannot hold the job.
Timer.scheduledTimer(withTimeInterval: 40, repeats: false) { _ in
    print("probe: stopped after 40 seconds")
    exit(4)
}
application.run()
