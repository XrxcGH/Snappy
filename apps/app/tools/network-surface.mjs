/**
 * The source and binary rules of the no-network guard (see check-no-network-deps.mjs, which runs them).
 *
 * The crate rules there say which libraries may be in the program. These say which parts of the program's OWN code may
 * touch the network, start a process or open the browser, so the update check stays the single, small place that does:
 *
 *   - WinHTTP only in src-tauri/src/updater/transport_windows.rs; no other way to download (WinINet, URLMon, BITS, sockets,
 *     `std::net`, `getaddrinfo`, `curl`, `powershell`) anywhere in the repository's Rust.
 *   - `#[link(...)]` attributes and `extern` blocks nowhere (the Windows calls come through the windows-sys crate).
 *   - A process may be started, and the browser opened, only in src-tauri/src/updater/launch_windows.rs.
 *   - The WinHTTP feature of windows-sys is enabled only in apps/app/src-tauri/Cargo.toml; core, the command line and the
 *     dashboard know nothing of the shell, the updater or Tauri.
 *   - The loopback test feature is off by default and named nowhere in the configuration or the workflows.
 *   - The built program imports winhttp.dll and not WinINet, URLMon or BITS, and holds no test setting or test key.
 *
 * Comments and test code are not scanned (a rule that forbids a word is not tripped by prose, and the tests legitimately
 * run a loopback server). Everything here is a pure function over text or bytes, so the guard's own tests can feed it
 * fixtures that must fail.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const norm = (p) => p.replaceAll("\\", "/");

/** Rust source with comments removed. `mask` is the same length with string and character contents blanked, for matching braces. */
export function stripRust(text) {
  let code = "";
  let mask = "";
  let i = 0;
  const n = text.length;
  const push = (s, blank = false) => {
    code += s;
    mask += blank ? s.replace(/[^\n]/g, " ") : s;
  };
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "/" && d === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (text[i] === "/" && text[i + 1] === "*") (depth++, (i += 2));
        else if (text[i] === "*" && text[i + 1] === "/") (depth--, (i += 2));
        else i++;
      }
      push(" ");
    } else if (c === "r" && /^r#*"/.test(text.slice(i, i + 12)) && !/[A-Za-z0-9_]/.test(text[i - 1] ?? "")) {
      const hashes = /^r(#*)"/.exec(text.slice(i, i + 12))[1];
      const close = `"${hashes}`;
      const end = text.indexOf(close, i + 2 + hashes.length);
      const stop = end < 0 ? n : end + close.length;
      push(text.slice(i, stop), true);
      i = stop;
    } else if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      push(text.slice(i, j + 1), true);
      i = j + 1;
    } else if (c === "'" && /^'(\\.[^']*|[^\\'])'/.test(text.slice(i, i + 12))) {
      const m = /^'(\\.[^']*|[^\\'])'/.exec(text.slice(i, i + 12));
      push(m[0], true);
      i += m[0].length;
    } else {
      push(c);
      i++;
    }
  }
  return { code, mask };
}

/** The production code of a Rust file: comments removed, and every item under a `cfg(...test...)` attribute removed. */
export function productionRust(text) {
  const { code, mask } = stripRust(text);
  const cuts = [];
  // Only items that exist in test builds and nowhere else: cfg(test) and cfg(all(test, ...)). A cfg(any(test, feature)) item
  // also exists in a feature build, so it stays in the scan.
  for (const m of mask.matchAll(/#\[\s*cfg\s*\(\s*(?:test|all\s*\(\s*test\b[^\]]*)\)\s*\]/g)) {
    if (cuts.some(([a, b]) => m.index >= a && m.index < b)) continue;
    let j = m.index + m[0].length;
    // skip further attributes
    for (;;) {
      const next = /^\s*#\[[^\]]*\]/.exec(mask.slice(j));
      if (!next) break;
      j += next[0].length;
    }
    const brace = mask.indexOf("{", j);
    const semi = mask.indexOf(";", j);
    let end;
    if (semi >= 0 && (brace < 0 || semi < brace)) end = semi + 1;
    else if (brace >= 0) {
      let depth = 0;
      end = brace;
      for (; end < mask.length; end++) {
        if (mask[end] === "{") depth++;
        else if (mask[end] === "}" && --depth === 0) break;
      }
      end++;
    } else end = mask.length;
    cuts.push([m.index, end]);
  }
  let out = "";
  let at = 0;
  for (const [a, b] of cuts.sort((x, y) => x[0] - y[0])) {
    if (a >= at) {
      out += code.slice(at, a);
      at = b;
    }
  }
  return out + code.slice(at);
}

const UPDATER = "apps/app/src-tauri/src/updater/";
const only = (suffix) => (file) => file.endsWith(suffix);
const nowhere = () => false;

/** [name, pattern, where it is allowed]. */
export const SOURCE_RULES = [
  ["WinHTTP outside the one transport file", /winhttp/i, only(`${UPDATER}transport_windows.rs`)],
  ["another way to reach the network", /\b(wininet|urlmon|ws2_32|WSAStartup|WinSock\w*|URLDownload\w*|IBackgroundCopy\w*|BackgroundCopyManager|getaddrinfo)\b|std::net\b|\b(TcpStream|UdpSocket|TcpListener)\b/i, nowhere],
  ["a link attribute or an extern block", /#\[\s*link\s*\(|\bextern\s*(?:"[A-Za-z0-9-]*"\s*)?\{/, nowhere],
  ["starting a process or opening the browser outside the one launch file", /std::process\b|\bCommand::new\b|\bCreateProcess\w*|\bShellExecute\w*/, only(`${UPDATER}launch_windows.rs`)],
  ["a download tool or shell command", /\b(curl|powershell|bitsadmin)\b|Invoke-WebRequest/i, nowhere],
];

/** Problems in one Rust file (`file` is its path from the repository root with forward slashes). */
export function checkRustSource(file, text) {
  const f = norm(file);
  if (/(^|\/)(tests|testdata)\//.test(f) || /\/(tests|testserver)\.rs$/.test(f)) return [];
  const code = productionRust(text);
  const problems = [];
  for (const [name, re, allowed] of SOURCE_RULES) {
    if (allowed(f)) continue;
    const m = re.exec(code);
    if (m) problems.push(`${f}: ${name} (found "${m[0]}")`);
  }
  return problems;
}

/** Problems in one Cargo.toml. */
export function checkCargoToml(file, text) {
  const f = norm(file);
  const problems = [];
  if (/Win32_Networking_WinHttp/i.test(text) && f !== "apps/app/src-tauri/Cargo.toml") problems.push(`${f}: the WinHTTP feature of windows-sys is enabled outside apps/app/src-tauri/Cargo.toml`);
  if (f !== "apps/app/src-tauri/Cargo.toml" && /^\s*windows-sys\s*=|^\s*minisign-verify\s*=/m.test(text)) problems.push(`${f}: windows-sys or minisign-verify is used outside the shell`);
  if (f === "apps/app/src-tauri/Cargo.toml") {
    const features = text.split("[features]")[1]?.split(/\n\[/)[0] ?? "";
    const defaults = /^\s*default\s*=\s*\[([^\]]*)\]/m.exec(features)?.[1] ?? "";
    if (/dev-update-endpoint|dev-hooks/.test(defaults)) problems.push(`${f}: a test feature is on by default`);
    if (!/^dev-update-endpoint\s*=\s*\[\]/m.test(features)) problems.push(`${f}: the dev-update-endpoint feature is missing or not an empty feature`);
  }
  return problems;
}

/** The test feature and its settings must be named nowhere in configuration or a release path. */
export function checkTestFeatureNotInRelease(file, text) {
  const f = norm(file);
  return /dev-update-endpoint|SNAPPY_UPDATE_ENDPOINT|SNAPPY_E2E_PUBKEYS|SNAPPY_E2E_VERSION|SNAPPY_E2E_UNIT_TESTS|com\.snappy\.e2e/.test(text) ? [`${f}: names the end-to-end test feature or its settings`] : [];
}

/** TypeScript or JavaScript of core, the command line and the dashboard must not reach the shell. */
export function checkWebSideImports(file, text) {
  const f = norm(file);
  return /(?:from|import)\s*\(?\s*["'][^"']*(apps\/app|@tauri-apps|update-ui|update-entry|update-model)[^"']*["']/.test(text) ? [`${f}: imports the desktop shell or its update code`] : [];
}

function* walk(dir, skip) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name)) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full, skip);
    else yield full;
  }
}

/** Runs every source rule over the repository at `root`. Returns the problems found. */
export function checkRepository(root) {
  const skip = new Set(["node_modules", "target", "dist", ".git", "gen", "frontend"]);
  const rel = (p) => norm(path.relative(root, p));
  const problems = [];
  for (const file of walk(root, skip)) {
    const r = rel(file);
    if (file.endsWith(".rs")) problems.push(...checkRustSource(r, readFileSync(file, "utf8")));
    else if (path.basename(file) === "Cargo.toml") problems.push(...checkCargoToml(r, readFileSync(file, "utf8")));
    else if (/^(packages\/[^/]+\/src|apps\/cli\/src|apps\/dashboard\/src)\/.*\.(ts|mjs|js)$/.test(r)) problems.push(...checkWebSideImports(r, readFileSync(file, "utf8")));
  }
  for (const file of ["apps/app/src-tauri/tauri.conf.json", "apps/app/package.json", "package.json"]) {
    const full = path.join(root, file);
    if (existsSync(full)) problems.push(...checkTestFeatureNotInRelease(file, readFileSync(full, "utf8")));
  }
  const workflows = path.join(root, ".github", "workflows");
  if (existsSync(workflows)) {
    for (const name of readdirSync(workflows)) {
      if (!name.endsWith(".yml")) continue;
      const text = readFileSync(path.join(workflows, name), "utf8");
      // A workflow may mention the feature only to refuse or grep for it, on a line that says so.
      const named = text.split(/\r?\n/).filter((l) => /dev-update-endpoint|SNAPPY_UPDATE_ENDPOINT|SNAPPY_E2E_PUBKEYS/.test(l) && !/grep|refus|must not|never|absent|forbid|fail/i.test(l));
      if (named.length) problems.push(`.github/workflows/${name}: names the end-to-end test feature on a line that is not a check for its absence`);
    }
  }
  return problems;
}

/**
 * Network APIs in a built page's script: `fetch(`, XMLHttpRequest, WebSocket, EventSource, sendBeacon, importScripts(.
 * The command helper removes these features from itself and names them only as quoted strings in its lists, so a name inside
 * quotes is allowed and any other use is not. Returns the matches.
 */
export function pageNetworkApis(html) {
  const unquoted = html.replace(/\\?"(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|sendBeacon)\\?"/g, '""');
  return [...unquoted.matchAll(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts\s*\(/g)].map((m) => m[0]);
}

// ---------------------------------------------------------------------------------------------------- the built program

/** The DLL names (lowercase) in the import tables of a Windows program (PE32 or PE32+), normal and delay-load. */
export function peImports(buf) {
  if (buf.length < 0x40 || buf.readUInt16LE(0) !== 0x5a4d) throw new Error("not a Windows program (no MZ header)");
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString("latin1", pe, pe + 4) !== "PE\0\0") throw new Error("not a Windows program (no PE header)");
  const sections = buf.readUInt16LE(pe + 6);
  const optionalSize = buf.readUInt16LE(pe + 20);
  const optional = pe + 24;
  const magic = buf.readUInt16LE(optional);
  if (magic !== 0x10b && magic !== 0x20b) throw new Error("unknown PE format");
  const directories = optional + (magic === 0x20b ? 112 : 96);
  const table = optional + optionalSize;
  const sectionList = [];
  for (let i = 0; i < sections; i++) {
    const s = table + i * 40;
    sectionList.push({ va: buf.readUInt32LE(s + 12), size: Math.max(buf.readUInt32LE(s + 8), buf.readUInt32LE(s + 16)), raw: buf.readUInt32LE(s + 20) });
  }
  const offset = (rva) => {
    const s = sectionList.find((x) => rva >= x.va && rva < x.va + x.size);
    if (!s) throw new Error("bad address in the PE import table");
    return rva - s.va + s.raw;
  };
  const cstr = (at) => buf.toString("latin1", at, buf.indexOf(0, at)).toLowerCase();
  const names = new Set();
  const read = (index, entrySize, nameField, stop) => {
    const dir = directories + index * 8;
    if (dir + 8 > buf.length) return;
    const rva = buf.readUInt32LE(dir);
    if (rva === 0) return;
    for (let at = offset(rva); at + entrySize <= buf.length; at += entrySize) {
      if (stop(at)) break;
      names.add(cstr(offset(buf.readUInt32LE(at + nameField))));
    }
  };
  read(1, 20, 12, (at) => buf.readUInt32LE(at + 12) === 0); // import directory
  read(13, 32, 4, (at) => buf.readUInt32LE(at + 4) === 0); // delay-load imports
  return [...names].sort();
}

const BANNED_DLLS = ["wininet.dll", "urlmon.dll", "qmgr.dll", "bitsproxy.dll", "bitsigd.dll"];
/** Names and texts that only a test build contains. */
export const TEST_ONLY_TEXT = ["SNAPPY_UPDATE_ENDPOINT", "SNAPPY_E2E_PUBKEYS", "SNAPPY_E2E_VERSION", "com.snappy.e2e", "TEST_ONLY"];

/**
 * Problems with a built Windows program: it must import winhttp.dll (it makes the update check) and none of the other
 * download libraries, and a release must hold no test setting, test identity or test key. `testKeys` are the TEST
 * public keys the repository knows.
 */
export function checkBinary(imports, bytes, testKeys = []) {
  const problems = [];
  if (!imports.includes("winhttp.dll")) problems.push("the program does not import winhttp.dll: the update check is missing or uses another route");
  for (const dll of BANNED_DLLS) if (imports.includes(dll)) problems.push(`the program imports ${dll}`);
  const text = bytes.toString("latin1");
  const utf16 = (s) => Buffer.from(s, "utf16le").toString("latin1");
  for (const needle of [...TEST_ONLY_TEXT, ...testKeys]) {
    if (needle && (text.includes(needle) || text.includes(utf16(needle)))) problems.push(`the program contains test-only text: ${needle.length > 40 ? `${needle.slice(0, 24)}...` : needle}`);
  }
  return problems;
}
