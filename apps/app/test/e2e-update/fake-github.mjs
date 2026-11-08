/**
 * A stand-in for the GitHub releases of the repository, bound to 127.0.0.1, for the update drill (run-e2e.mjs) and its
 * tests. It serves `latest.json` and the installers under the paths the real releases use, in one of several modes (a
 * correct release, or one broken in a particular way), and records every request so a drill can prove that the app sent
 * nothing before it should, or nothing at all.
 *
 * Nothing here is a secret or reads a key: signatures are produced elsewhere (by `tauri signer sign` with TEST keys) and
 * handed in as text.
 */
import http from "node:http";

export const BASE_PATH = "/XrxcGH/Snappy";

/** The manifest the app expects: Tauri's static JSON with one platform entry. */
export function manifestFor(origin, { version, signature, url, extra = {} }) {
  const installer = url ?? `${origin}${BASE_PATH}/releases/download/v${version}/Snappy_${version}_x64-setup.exe`;
  return JSON.stringify({ version, notes: "TEST release", pub_date: "2026-01-01T00:00:00Z", platforms: { "windows-x86_64": { signature, url: installer } }, ...extra });
}

/**
 * Starts the server. `release()` is read on every request and says what is published right now:
 *   { version, installer: Buffer, signature: string }
 * plus optional faults: manifestStatus, manifestRedirect, installerRedirect, wrongUrl, noLength, contentEncoding, declaredLength,
 * stripSignature (the manifest has no signature field), versionInManifest (the manifest names another version than the file).
 * Returns { origin, base, requests, close }.
 */
export async function startFakeGithub(release, { host = "127.0.0.1", handlerWrap } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const r = release();
    requests.push({ method: req.method, path: req.url, headers: { ...req.headers }, at: Date.now() });
    const origin = `http://${req.headers.host}`;
    const latest = `${BASE_PATH}/releases/latest/download/latest.json`;
    const file = `${BASE_PATH}/releases/download/v${r.version}/Snappy_${r.version}_x64-setup.exe`;
    const send = (status, body, headers = {}) => {
      res.writeHead(status, headers);
      res.end(body);
    };
    if (handlerWrap?.(req, res, r)) return;
    if (req.url === latest) {
      if (r.manifestStatus) return send(r.manifestStatus, "");
      if (r.manifestRedirect) return send(302, "", { Location: r.manifestRedirect });
      const manifest = JSON.parse(manifestFor(origin, { version: r.versionInManifest ?? r.version, signature: r.signature, url: r.wrongUrl ? `${origin}/elsewhere.exe` : undefined }));
      if (r.stripSignature) delete manifest.platforms["windows-x86_64"].signature;
      return send(200, JSON.stringify(manifest), { "Content-Type": "application/json" });
    }
    if (req.url === file) {
      if (r.installerRedirect) return send(302, "", { Location: r.installerRedirect });
      const headers = { "Content-Type": "application/octet-stream" };
      if (r.contentEncoding) headers["Content-Encoding"] = r.contentEncoding;
      if (!r.noLength) headers["Content-Length"] = String(r.declaredLength ?? r.installer.length);
      res.writeHead(200, headers);
      return res.end(r.installer);
    }
    return send(404, "");
  });
  await new Promise((resolve) => server.listen(0, host, resolve));
  const { port } = server.address();
  const origin = `http://${host}:${port}`;
  return {
    origin,
    /** What the app's `SNAPPY_UPDATE_ENDPOINT` is set to. */
    base: `${origin}${BASE_PATH}`,
    requests,
    close: () => new Promise((resolve) => (server.closeAllConnections?.(), server.close(resolve))),
  };
}
