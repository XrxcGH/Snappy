/**
 * Tiny local static server for people who prefer http:// to double-clicking the file.
 * Binds to 127.0.0.1 only (never the network), serves the files in dist/ and nothing else,
 * and refuses requests whose Host header is not a loopback name (DNS rebinding).
 *
 *   node serve.mjs [--port 4173]
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 4173;
const HOST = "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
};

/** Headers every response carries. The page also holds its own policy in a meta tag; frame-ancestors can only be set here. */
const SECURITY_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
};

function loopbackHost(header, port) {
  if (typeof header !== "string") return false;
  return header === `127.0.0.1:${port}` || header === `localhost:${port}` || header === `[::1]:${port}`;
}

/** Resolve a request path to a file inside root, or null for anything that escapes it or is not a plain file name. */
export function resolveRequest(root, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const full = path.resolve(root, relative);
  return full === root || !full.startsWith(root + path.sep) ? null : full;
}

export async function startServer({ root = path.join(here, "dist"), port = DEFAULT_PORT } = {}) {
  const resolvedRoot = path.resolve(root);
  try {
    await readFile(path.join(resolvedRoot, "index.html"));
  } catch {
    throw new Error("There is no build yet. Run: npm run build -w @snappy-export/dashboard");
  }

  let boundPort = port;
  const server = createServer(async (req, res) => {
    const reply = (status, body, type = "text/plain; charset=utf-8", extra = {}) => {
      res.writeHead(status, { "Content-Type": type, ...SECURITY_HEADERS, ...extra });
      res.end(req.method === "HEAD" ? undefined : body);
    };

    if (req.method !== "GET" && req.method !== "HEAD") return reply(405, "Method not allowed.", undefined, { Allow: "GET, HEAD" });
    if (!loopbackHost(req.headers.host, boundPort)) return reply(403, "Forbidden.");

    const file = resolveRequest(resolvedRoot, req.url ?? "/");
    const type = file ? TYPES[path.extname(file).toLowerCase()] : undefined;
    if (!file || !type) return reply(404, "Not found.");
    try {
      const body = await readFile(file);
      // The header repeats the page's own policy (read fresh, so a rebuild never leaves a stale one) and adds frame-ancestors.
      const csp = type.startsWith("text/html") ? /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(body.toString("utf8"))?.[1] : undefined;
      const frameGuard = csp ? { "Content-Security-Policy": `${csp}; frame-ancestors 'none'` } : {};
      return reply(200, body, type, frameGuard);
    } catch {
      return reply(404, "Not found.");
    }
  });

  // If the preferred port is taken, try the next few instead of failing.
  const listen = (candidate, attemptsLeft) =>
    new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE" && attemptsLeft > 0 && port !== 0) resolve(listen(candidate + 1, attemptsLeft - 1));
        else reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        boundPort = server.address().port;
        resolve(boundPort);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(candidate, HOST);
    });

  await listen(port, 20);
  return { server, port: boundPort, url: `http://${HOST}:${boundPort}/`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const flag = process.argv.indexOf("--port");
  const requested = flag >= 0 ? Number(process.argv[flag + 1]) : DEFAULT_PORT;
  if (!Number.isInteger(requested) || requested < 0 || requested > 65535) {
    console.error("The port must be a whole number from 0 to 65535.");
    process.exit(1);
  }
  try {
    const { url } = await startServer({ port: requested });
    console.log(`Snappy is running at ${url}`);
    console.log("It only listens on this computer. Press Ctrl+C to stop.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Snappy could not start the server.");
    process.exit(1);
  }
}
