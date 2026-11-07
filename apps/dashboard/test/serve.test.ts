/** The local server: loopback only, static files from dist, nothing else. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = mkdtempSync(path.join(tmpdir(), "snappy-serve-"));

interface Running {
  server: http.Server;
  port: number;
  url: string;
  close: () => Promise<void>;
}
type ServeModule = { startServer: (o: { root: string; port: number }) => Promise<Running>; resolveRequest: (root: string, url: string) => string | null };

let mod: ServeModule;
let running: Running;

beforeAll(async () => {
  mod = (await import(pathToFileURL(path.join(root, "serve.mjs")).href)) as ServeModule;
  mkdirSync(path.join(tmp, "dist", "licenses"), { recursive: true });
  writeFileSync(path.join(tmp, "dist", "index.html"), `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; connect-src 'none'"><p>hi</p>`);
  writeFileSync(path.join(tmp, "dist", "licenses", "a.txt"), "license");
  writeFileSync(path.join(tmp, "secret.txt"), "outside");
  running = await mod.startServer({ root: path.join(tmp, "dist"), port: 0 });
});

afterAll(async () => {
  await running.close();
  rmSync(tmp, { recursive: true, force: true });
});

function request(pathName: string, options: { method?: string; host?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port: running.port, path: pathName, method: options.method ?? "GET", headers: { Host: options.host ?? `127.0.0.1:${running.port}` } },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("serve.mjs", () => {
  it("listens on 127.0.0.1 only", () => {
    expect(running.server.address()).toMatchObject({ address: "127.0.0.1" });
    expect(running.url).toBe(`http://127.0.0.1:${running.port}/`);
  });

  it("serves the page with the security headers and repeats the page policy plus frame-ancestors", async () => {
    const res = await request("/");
    expect(res.status).toBe(200);
    expect(res.body).toContain("<p>hi</p>");
    expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["content-security-policy"]).toBe("default-src 'none'; connect-src 'none'; frame-ancestors 'none'");
  });

  it("serves the license files and nothing outside dist", async () => {
    expect((await request("/licenses/a.txt")).body).toBe("license");
    for (const bad of ["/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt", "/licenses/../../secret.txt", "/%5c..%5csecret.txt", "/missing.html", "/licenses/", "/index.html%00.txt"]) {
      const res = await request(bad);
      expect(res.status, bad).toBe(404);
      expect(res.body).not.toContain("outside");
    }
  });

  it("refuses other methods and foreign Host headers (DNS rebinding)", async () => {
    expect((await request("/", { method: "POST" })).status).toBe(405);
    expect((await request("/", { host: "evil.example" })).status).toBe(403);
    expect((await request("/", { host: `evil.example:${running.port}` })).status).toBe(403);
    expect((await request("/", { host: `localhost:${running.port}` })).status).toBe(200);
  });

  it("resolves request paths only inside the root", () => {
    const base = path.join(tmp, "dist");
    expect(mod.resolveRequest(base, "/")).toBe(path.join(base, "index.html"));
    expect(mod.resolveRequest(base, "/licenses/a.txt")).toBe(path.join(base, "licenses", "a.txt"));
    expect(mod.resolveRequest(base, "/../x")).toBeNull();
    expect(mod.resolveRequest(base, "/a\\b")).toBeNull();
    expect(mod.resolveRequest(base, "/%E0%A4%A")).toBeNull();
  });

  it("explains how to build when there is no build yet", async () => {
    await expect(mod.startServer({ root: path.join(tmp, "nothing-here"), port: 0 })).rejects.toThrow(/Run: npm run build/);
  });
});
