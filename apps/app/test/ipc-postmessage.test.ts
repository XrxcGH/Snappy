/**
 * The page talks to the shell over postMessage only. Tauri's default tries a fetch to ipc.localhost first, which the page's
 * `connect-src 'none'` blocks, so every load logged two policy violations and three console errors before Tauri fell back to
 * postMessage. The shell now installs a small message sender that never tries the fetch, and the policy stays as it was.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p: string[]): string => readFileSync(path.join(root, ...p), "utf8");
const script = read("src-tauri", "src", "ipc_postmessage.js");
const lib = read("src-tauri", "src", "lib.rs");

/** Runs the script the way Tauri does (the `__INVOKE_KEY__` token replaced) against a fake window. */
function load(): { sent: string[]; network: string[]; send: (message: object) => void } {
  const sent: string[] = [];
  const network: string[] = [];
  const internals: Record<string, unknown> = {};
  const record = (name: string) => () => {
    network.push(name);
    throw new Error(`${name} must not be used`);
  };
  const window = { __TAURI_INTERNALS__: internals, ipc: { postMessage: (data: string) => sent.push(data) }, fetch: record("fetch") };
  vm.runInNewContext(script.replace("__INVOKE_KEY__", '"key-123"'), { window, fetch: window.fetch, XMLHttpRequest: record("XMLHttpRequest") });
  return { sent, network, send: (message) => (internals.postMessage as (m: object) => void)(message) };
}

describe("the shell's message sender", () => {
  it("is installed as the shell's invoke system", () => {
    expect(lib).toMatch(/\.invoke_system\(include_str!\("ipc_postmessage\.js"\)\)/);
    expect(script).toContain("__INVOKE_KEY__");
  });

  it("sends a command through window.ipc and never touches the network", () => {
    const page = load();
    page.send({ cmd: "update_status", callback: 11, error: 12, payload: {}, options: undefined });
    expect(page.network).toEqual([]);
    expect(page.sent).toHaveLength(1);
    expect(JSON.parse(page.sent[0] as string)).toEqual({
      cmd: "update_status",
      callback: 11,
      error: 12,
      payload: {},
      options: { customProtocolIpcBlocked: true },
      __TAURI_INVOKE_KEY__: "key-123",
    });
  });

  it("keeps the arguments and options, and tells the shell to answer without a channel", () => {
    const page = load();
    page.send({ cmd: "read_range", callback: 1, error: 2, payload: { id: 7, offset: 0, length: 3 }, options: { headers: { x: "y" } } });
    const message = JSON.parse(page.sent[0] as string);
    expect(message.payload).toEqual({ id: 7, offset: 0, length: 3 });
    expect(message.options).toEqual({ headers: { x: "y" }, customProtocolIpcBlocked: true });
  });

  it("has no network API of its own", () => {
    expect(script).not.toMatch(/\bfetch\b|XMLHttpRequest|WebSocket|ipc\.localhost|sendBeacon/);
  });
});
