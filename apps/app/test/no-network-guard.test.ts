/**
 * The no-network guard's own tests. The repository as it is must pass every rule, and every rule must also FAIL on a fixture
 * that breaks it: a stray HTTP client crate, WinHTTP in core or in another updater file, a process started to run curl, a
 * link attribute for WinINet, a network call in the page, a built program that imports WinINet or carries a test key, and the
 * end-to-end test feature on a workflow line.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module without types
import { bannedCrates, tokioFeatures } from "../tools/check-no-network-deps.mjs";
// @ts-expect-error plain JavaScript module without types
import { BANNED_DLLS, checkBinary, checkCargoToml, checkLockfile, checkRepository, checkRustSource, checkTestFeatureNotInRelease, checkWebSideImports, pageNetworkApis, peImports, productionRust, stripRust } from "../tools/network-surface.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const UPDATER = "apps/app/src-tauri/src/updater";

describe("the repository as it is", () => {
  it("passes every source rule", () => {
    expect(checkRepository(root)).toEqual([]);
  });

  it("confines WinHTTP to one file and process starting to another, by name", () => {
    const rust = readFileSync(path.join(root, UPDATER, "transport_windows.rs"), "utf8");
    expect(productionRust(rust)).toMatch(/WinHttp/);
    expect(checkRustSource(`${UPDATER}/transport_windows.rs`, rust)).toEqual([]);
    const launch = readFileSync(path.join(root, UPDATER, "launch_windows.rs"), "utf8");
    expect(productionRust(launch)).toMatch(/Command::new/);
    expect(checkRustSource(`${UPDATER}/launch_windows.rs`, launch)).toEqual([]);
  });
});

describe("the crate rules (unchanged) still fail on a stray network crate", () => {
  it("finds an HTTP client, a TLS library or tokio's net feature in a dependency tree", () => {
    expect(bannedCrates("snappy v0.1.0\nreqwest v0.12.0\nserde v1.0.0\nrustls v0.23.0\n")).toEqual(["reqwest", "rustls"]);
    expect(bannedCrates("snappy v0.1.0\nminisign-verify v0.3.0\nwindows-sys v0.61.2\nsha2 v0.10.9\nurl v2.5.8\n")).toEqual([]);
    expect(tokioFeatures('tokio feature "default"\ntokio feature "net"\n')).toContain("net");
  });
});

describe("source rules fail on a fixture that breaks each one", () => {
  const winhttp = 'unsafe { WinHttpOpen(agent, 0, null(), null(), 0) };';
  const cases: [string, string, string, RegExp][] = [
    ["WinHTTP in core", "packages/core/src/lib.rs", winhttp, /WinHTTP outside/],
    ["WinHTTP in another updater file", `${UPDATER}/mod.rs`, winhttp, /WinHTTP outside/],
    ["the WinHTTP module path in another file", `${UPDATER}/verify.rs`, "use windows_sys::Win32::Networking::WinHttp::WinHttpOpen;", /WinHTTP outside/],
    ["Command::new in the transport", `${UPDATER}/transport_windows.rs`, 'let c = Command::new("cmd");', /process/],
    ["a process in the shell", "apps/app/src-tauri/src/lib.rs", 'std::process::Command::new("explorer");', /process/],
    ["ShellExecute elsewhere", `${UPDATER}/mod.rs`, "ShellExecuteW(0, a, b, c, d, 1);", /process/],
    ["CreateProcess elsewhere", `${UPDATER}/store.rs`, "CreateProcessW(a, b);", /process/],
    ["curl even in the launch file", `${UPDATER}/launch_windows.rs`, 'Command::new("curl").arg("https://example.test");', /download tool/],
    ["powershell", `${UPDATER}/launch_windows.rs`, 'let shell = "powershell";', /download tool/],
    ["bitsadmin", "apps/app/src-tauri/src/lib.rs", 'run("bitsadmin /transfer");', /download tool/],
    ["Invoke-WebRequest", "apps/app/src-tauri/src/lib.rs", 'let s = "Invoke-WebRequest -Uri x";', /download tool/],
    ["a link attribute for WinINet", `${UPDATER}/transport_windows.rs`, '#[link(name = "wininet")] extern "system" { fn InternetOpenW(); }', /link attribute|another way/],
    ["an extern block", `${UPDATER}/transport_windows.rs`, 'extern "system" { fn Open(); }', /link attribute or an extern/],
    ["a bare extern block", "apps/app/src-tauri/src/lib.rs", "extern { fn f(); }", /extern/],
    ["WinINet by name", `${UPDATER}/transport_windows.rs`, "let lib = wininet::InternetOpenW;", /another way/],
    ["URLMon", `${UPDATER}/mod.rs`, 'let f = "URLDownloadToFileW";', /another way/],
    ["WinSock", "apps/app/src-tauri/src/lib.rs", "WSAStartup(0x202, &mut data);", /another way/],
    ["a standard library socket", "apps/app/src-tauri/src/lib.rs", "let s = std::net::TcpStream::connect(a);", /another way/],
    ["a listener in production code", `${UPDATER}/mod.rs`, "let l = TcpListener::bind(a);", /another way/],
    ["getaddrinfo", `${UPDATER}/transport.rs`, "getaddrinfo(a, b, c, d);", /another way/],
    ["BITS", `${UPDATER}/mod.rs`, "let m = BackgroundCopyManager;", /another way/],
    ["a DNS lookup through ToSocketAddrs in a brace import", "apps/app/src-tauri/src/lib.rs", 'use std::{net::ToSocketAddrs};\nlet a = "example.test:80".to_socket_addrs();', /another way/],
    ["a brace import that contains net", "apps/app/src-tauri/src/lib.rs", "use std::{io, net};", /another way/],
    ["to_socket_addrs alone", "apps/app/src-tauri/src/lib.rs", 'let a = "example.test:80".to_socket_addrs();', /another way/],
    ["tokio's lookup_host", "apps/app/src-tauri/src/lib.rs", 'let a = lookup_host("example.test:80");', /another way/],
    ["a net module of anything", "apps/app/src-tauri/src/lib.rs", "let s = tokio::net::TcpStream::connect(a);", /another way/],
    ["a socket address type", "apps/app/src-tauri/src/lib.rs", "fn f(a: SocketAddr) {}", /another way/],
    ["core::net", "apps/app/src-tauri/src/lib.rs", "use core::net::SocketAddr;", /another way/],
    ["WinExec", `${UPDATER}/launch_windows.rs`, 'WinExec(cmd, 0);', /download tool/],
    ["cmd.exe", `${UPDATER}/launch_windows.rs`, 'let c = "cmd.exe";', /download tool/],
    ["a DNS query through windows-sys", "apps/app/src-tauri/src/lib.rs", "use windows_sys::Win32::NetworkManagement::Dns::DnsQuery_W;", /another way/],
    ["another Networking module of windows-sys", "apps/app/src-tauri/src/lib.rs", "use windows_sys::Win32::Networking::WinSock::WSAStartup;", /another way/],
    ["a DNS function", "apps/app/src-tauri/src/lib.rs", "DnsQuery_A(name, 1, 0, null_mut(), &mut r, null_mut());", /another way/],
    ["include! of a text file", "apps/app/src-tauri/src/lib.rs", 'include!("other.txt");', /read less/],
    ["a path attribute to a text file", "apps/app/src-tauri/src/lib.rs", '#[path = "other.txt"]\nmod x;', /read less/],
    ["code generated into OUT_DIR", "apps/app/src-tauri/src/lib.rs", 'include!(concat!(env!("OUT_DIR"), "/x.rs"));', /read less/],
    ["std renamed", "apps/app/src-tauri/src/lib.rs", "use std as s;", /read less/],
  ];
  for (const [name, file, text, why] of cases) {
    it(`fails: ${name}`, () => {
      const problems = checkRustSource(file, `fn x() {\n${text}\n}\n`);
      expect(problems.length, name).toBeGreaterThan(0);
      expect(problems.join("\n")).toMatch(why);
    });
  }

  it("does not flag prose, test code, or the files that are allowed to hold a thing", () => {
    expect(checkRustSource("apps/app/src-tauri/src/lib.rs", "// WinHttpOpen and curl and std::net\n/* TcpStream */\nfn x() {}\n")).toEqual([]);
    expect(checkRustSource("apps/app/src-tauri/src/lib.rs", '#[cfg(test)]\nmod tests {\n    fn t() { let l = std::net::TcpListener::bind("127.0.0.1:0"); }\n}\nfn real() {}\n')).toEqual([]);
    expect(checkRustSource("apps/app/src-tauri/src/lib.rs", '#[cfg(all(test, windows))]\nmod tests;\nfn real() {}\n')).toEqual([]);
    expect(checkRustSource(`${UPDATER}/testserver.rs`, "use std::net::TcpListener;")).toEqual([]);
    expect(checkRustSource(`${UPDATER}/transport_windows.rs`, "use windows_sys::Win32::Networking::WinHttp::WinHttpOpen;")).toEqual([]);
    expect(checkRustSource(`${UPDATER}/launch_windows.rs`, 'let c = std::process::Command::new(path);')).toEqual([]);
    // an item that also exists in a feature build is NOT test code
    expect(checkRustSource("apps/app/src-tauri/src/lib.rs", '#[cfg(any(test, feature = "dev-update-endpoint"))]\nfn x() { let l = std::net::TcpListener::bind(a); }\n').length).toBeGreaterThan(0);
  });

  it("still allows the path attribute of a test module and plain mentions of the word net", () => {
    expect(checkRustSource("apps/app/src-tauri/src/lib.rs", '#[cfg(test)]\n#[path = "../build_guards.rs"]\nmod build_guards;\nfn real() { let planet = 1; let network_name = "net"; }\n')).toEqual([]);
  });

  it("is not fooled by strings that look like comments, raw strings or lifetimes", () => {
    const code = 'let url = "https://github.com/x"; // curl\nlet r = r#"std::net"#;\nfn f<\'a>(x: &\'a str) { let c = \'"\'; }\nstd::net::TcpStream::connect(a);\n';
    expect(checkRustSource("apps/app/src-tauri/src/lib.rs", code).join("\n")).toMatch(/another way/);
    expect(stripRust('let a = "// not a comment"; // a comment\nlet b = 1;').code).toBe('let a = "// not a comment"; \nlet b = 1;');
  });
});

describe("manifest rules fail on a fixture", () => {
  const good = '[features]\ndev-hooks = []\ndev-update-endpoint = []\n[dependencies]\nserde = "1"\n';
  it("accepts the real shell manifest and refuses WinHTTP or windows-sys elsewhere", () => {
    expect(checkCargoToml("apps/app/src-tauri/Cargo.toml", readFileSync(path.join(root, "apps/app/src-tauri/Cargo.toml"), "utf8"))).toEqual([]);
    expect(checkCargoToml("packages/core/Cargo.toml", 'windows-sys = { version = "0.61", features = ["Win32_Networking_WinHttp"] }')).toHaveLength(2);
    expect(checkCargoToml("apps/cli/Cargo.toml", 'windows-sys = "0.61"')).toHaveLength(1);
    expect(checkCargoToml("apps/app/src-tauri/Cargo.toml", `${good}\n`)).toEqual([]);
  });

  it("refuses any networking feature of windows or windows-sys but WinHTTP, in the shell and elsewhere", () => {
    const shell = readFileSync(path.join(root, "apps/app/src-tauri/Cargo.toml"), "utf8");
    for (const feature of ["Win32_Networking_WinSock", "Win32_NetworkManagement_Dns", "Win32_NetworkManagement_IpHelper", "Win32_Networking_Ldap", "Win32_Networking_Clustering"]) {
      expect(checkCargoToml("apps/app/src-tauri/Cargo.toml", shell.replace('"Win32_Foundation",', `"Win32_Foundation",\n  "${feature}",`)).join(), feature).toMatch(new RegExp(feature));
      expect(checkCargoToml("packages/core/Cargo.toml", `windows = { version = "0.62", features = ["${feature}"] }`).join(), feature).toMatch(new RegExp(feature));
    }
  });

  it("refuses the loopback test feature being on by default or missing", () => {
    expect(checkCargoToml("apps/app/src-tauri/Cargo.toml", good.replace("[features]\n", '[features]\ndefault = ["dev-update-endpoint"]\n')).join()).toMatch(/on by default/);
    expect(checkCargoToml("apps/app/src-tauri/Cargo.toml", '[features]\ndev-hooks = []\n').join()).toMatch(/missing/);
  });

  it("refuses the test feature and its settings in configuration", () => {
    expect(checkTestFeatureNotInRelease("apps/app/src-tauri/tauri.conf.json", '{"identifier": "com.snappy.e2e"}')).toHaveLength(1);
    expect(checkTestFeatureNotInRelease("package.json", '{"scripts": {"x": "cargo build --features dev-update-endpoint"}}')).toHaveLength(1);
    expect(checkTestFeatureNotInRelease("apps/app/src-tauri/tauri.conf.json", '{"identifier": "com.snappy.export"}')).toEqual([]);
  });

  it("refuses the dashboard, core or the command line importing the shell", () => {
    expect(checkWebSideImports("apps/dashboard/src/main.ts", 'import { invoke } from "@tauri-apps/api/core";')).toHaveLength(1);
    expect(checkWebSideImports("packages/core/src/x.ts", 'import "../../../apps/app/src/update-ui.ts";')).toHaveLength(1);
    expect(checkWebSideImports("apps/dashboard/src/x.ts", 'import("@tauri-apps/api")')).toHaveLength(1);
    expect(checkWebSideImports("apps/dashboard/src/x.ts", 'import { h } from "./dom.ts";')).toEqual([]);
  });
});

describe("a crate nobody approved fails, even one no denylist knows", () => {
  const approved = readFileSync(path.join(root, "apps/app/tools/approved-crates.txt"), "utf8");
  const lock = readFileSync(path.join(root, "apps/app/src-tauri/Cargo.lock"), "utf8");
  const entry = (name: string) => `\n[[package]]\nname = "${name}"\nversion = "0.1.0"\nsource = "registry+https://github.com/rust-lang/crates.io-index"\n`;

  it("accepts the lock file as it is", () => {
    expect(checkLockfile("apps/app/src-tauri/Cargo.lock", lock, approved)).toEqual([]);
  });

  it("finds a new HTTP, socket, DNS or runtime crate by its name alone", () => {
    for (const name of ["minreq", "async-io", "nyquest", "some-crate-nobody-has-heard-of", "hickory-proto"]) {
      const problems = checkLockfile("apps/app/src-tauri/Cargo.lock", lock + entry(name), approved);
      expect(problems.join(), name).toContain(`"${name}"`);
      expect(problems).toHaveLength(1);
    }
  });

  it("does not mind a version change, which Dependabot makes, or comments in the list", () => {
    expect(checkLockfile("x", lock.replaceAll('version = "', 'version = "9'), approved)).toEqual([]);
    expect(checkLockfile("x", entry("serde"), "# a comment\nserde  # trailing\n")).toEqual([]);
  });

  it("is part of the repository check and fails when the list is missing", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "snappy-guard-"));
    try {
      mkdirSync(path.join(dir, "apps", "app", "src-tauri"), { recursive: true });
      writeFileSync(path.join(dir, "apps", "app", "src-tauri", "Cargo.lock"), lock);
      expect(checkRepository(dir).join()).toMatch(/approved-crates\.txt is missing/);
      mkdirSync(path.join(dir, "apps", "app", "tools"), { recursive: true });
      writeFileSync(path.join(dir, "apps", "app", "tools", "approved-crates.txt"), "serde\n");
      expect(checkRepository(dir).join()).toMatch(/not in apps\/app\/tools\/approved-crates\.txt/);
      writeFileSync(path.join(dir, "apps", "app", "tools", "approved-crates.txt"), approved);
      expect(checkRepository(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("knows the best-known network crates as a second, separate check", () => {
    expect(bannedCrates("snappy v0.1.0\nminreq v2.0.0\nsocket2 v0.5.0\nmio v1.0.0\nasync-io v2.0.0\nnyquest v0.1.0\n")).toEqual(["async-io", "minreq", "mio", "nyquest", "socket2"]);
  });
});

describe("workflow lines that name the test feature fail", () => {
  const withWorkflow = (text: string): string[] => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "snappy-guard-"));
    try {
      mkdirSync(path.join(dir, ".github", "workflows"), { recursive: true });
      writeFileSync(path.join(dir, ".github", "workflows", "release.yml"), text);
      return checkRepository(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("fails on a build line with the feature, or its setting, and passes on a check for its absence", () => {
    expect(withWorkflow("jobs:\n  b:\n    steps:\n      - run: cargo build --features dev-update-endpoint\n")).toHaveLength(1);
    expect(withWorkflow("      - run: SNAPPY_UPDATE_ENDPOINT=http://127.0.0.1:1 npm run build\n")).toHaveLength(1);
    expect(withWorkflow("      - run: grep -c SNAPPY_UPDATE_ENDPOINT snappy.exe && exit 1\n")).toEqual([]);
    expect(withWorkflow("      - run: echo ok\n")).toEqual([]);
  });
});

describe("the built program's rules fail on a fixture", () => {
  const winhttp = ["kernel32.dll", "winhttp.dll", "user32.dll"];

  it("accepts a program that imports WinHTTP and nothing else for downloads", () => {
    expect(checkBinary(winhttp, Buffer.from("MZ plain program"), ["RWSAMPLE"])).toEqual([]);
  });

  it("fails when it imports WinINet, URLMon or BITS, or does not import WinHTTP", () => {
    for (const dll of ["wininet.dll", "urlmon.dll", "qmgr.dll", "bitsproxy.dll"]) expect(checkBinary([...winhttp, dll], Buffer.from("x")).join(), dll).toMatch(new RegExp(dll));
  });

  it("fails when it imports Winsock, DNS, IP helper, the HTTP server API or RAS next to WinHTTP", () => {
    for (const dll of ["ws2_32.dll", "wsock32.dll", "mswsock.dll", "dnsapi.dll", "iphlpapi.dll", "httpapi.dll", "rasapi32.dll"]) {
      expect(BANNED_DLLS, dll).toContain(dll);
      expect(checkBinary([...winhttp, dll], Buffer.alloc(10)).join(), dll).toMatch(new RegExp(dll.replace(".", "\\.")));
    }
    expect(checkBinary(["kernel32.dll"], Buffer.from("x")).join()).toMatch(/does not import winhttp/);
  });

  it("fails on the test settings, the test identity and a test key, in ASCII or UTF-16", () => {
    for (const text of ["SNAPPY_UPDATE_ENDPOINT", "SNAPPY_E2E_PUBKEYS", "com.snappy.e2e", "TEST_ONLY_DEFAULT_KEY"]) {
      expect(checkBinary(winhttp, Buffer.from(`xx ${text} xx`)).length, text).toBe(1);
      expect(checkBinary(winhttp, Buffer.from(`x${text}`, "utf16le")).length, `${text} as UTF-16`).toBe(1);
    }
    const key = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDAxNDE0Mjk2QUQ0QTIwRTAKUldUZ0lFcXRsa0pCQWFHT1prVU5qLzk0c3FsS2ltdGhyUm4rSTRVOU8zZ2Qvck5Pdk5QbmxuYVQK";
    expect(checkBinary(winhttp, Buffer.from(`..${key}..`), [key]).length).toBe(1);
  });

  it("reads the import table of a real Windows program", () => {
    if (process.platform !== "win32") return;
    const imports = peImports(readFileSync(process.execPath));
    expect(imports).toContain("kernel32.dll");
    expect(imports.every((n: string) => /^[a-z0-9_.()-]+$/.test(n)), imports.join()).toBe(true);
    expect(() => peImports(Buffer.from("not a program"))).toThrow(/MZ/);
    expect(() => peImports(Buffer.concat([Buffer.from("MZ"), Buffer.alloc(100)]))).toThrow(/PE/);
  });
});

describe("a network call in a page fails", () => {
  it("finds fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon and importScripts, but not their names in quoted lists", () => {
    for (const code of ['fetch("/x")', "new XMLHttpRequest()", 'new WebSocket("ws://x")', "new EventSource(u)", "navigator.sendBeacon(u)", "importScripts(u)"]) {
      expect(pageNetworkApis(`<script>${code}</script>`).length, code).toBeGreaterThan(0);
    }
    expect(pageNetworkApis('const names = ["fetch","XMLHttpRequest","WebSocket","EventSource","importScripts","sendBeacon"];')).toEqual([]);
  });
});
