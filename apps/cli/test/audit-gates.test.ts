/**
 * The dependency gates in CI: licenses, advisories and the pinned lint tool. These read the files themselves, so a
 * later edit cannot quietly drop a check, widen the license list, or give the audit job more than a read-only token.
 * (They check the text of the files; the checks themselves run in CI.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (...parts: string[]): string => readFileSync(path.join(repo, ...parts), "utf8");
/** The file without comment lines, so a sentence about a rule cannot satisfy a check for the rule. */
const code = (text: string): string => text.split(/\r?\n/).filter((l) => !l.trim().startsWith("#")).join("\n");

describe("deny.toml", () => {
  const deny = code(read("deny.toml"));
  const allowed = (): string[] => {
    const block = /\[licenses\][\s\S]*?allow = \[([\s\S]*?)\]/.exec(deny)?.[1] ?? "";
    return [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
  };

  it("allows permissive licenses and MPL-2.0 only, never a strong copyleft license", () => {
    const list = allowed();
    expect(list).toEqual(expect.arrayContaining(["MIT", "Apache-2.0", "MPL-2.0", "BSD-3-Clause", "Unicode-3.0"]));
    for (const license of list) expect(license, license).not.toMatch(/GPL|SSPL|BUSL|Commons-Clause|proprietary/i);
  });

  it("denies yanked crates and crates from an unknown registry or git source", () => {
    expect(deny).toMatch(/yanked = "deny"/);
    expect(deny).toMatch(/unknown-registry = "deny"/);
    expect(deny).toMatch(/unknown-git = "deny"/);
    expect(deny).toMatch(/allow-git = \[\]/);
  });

  it("bans the crates that speak a network protocol or link a TLS stack", () => {
    for (const name of ["reqwest", "hyper", "openssl", "native-tls", "rustls", "ureq"]) expect(deny, name).toContain(`{ crate = "${name}" }`);
  });

  it("documents every ignored advisory with a reason", () => {
    const ignores = [...deny.matchAll(/\{ id = "(RUSTSEC-[\d-]+)"([^}]*)\}/g)];
    for (const m of ignores) expect(m[2], m[1]).toMatch(/reason = "[^"]{20,}"/);
  });
});

describe("audit workflow", () => {
  const text = read(".github", "workflows", "audit.yml");
  const body = code(text);

  it("runs cargo deny on the shell's manifest for licenses, bans, sources and advisories", () => {
    expect(body).toMatch(/cargo deny --manifest-path apps\/app\/src-tauri\/Cargo\.toml check licenses bans sources/);
    expect(body).toMatch(/cargo deny --manifest-path apps\/app\/src-tauri\/Cargo\.toml check advisories/);
  });

  it("audits the npm packages that ship, at high severity", () => {
    expect(body).toMatch(/npm audit --omit=dev --audit-level=high/);
  });

  it("installs cargo-deny at a fixed version from the locked registry, not through an action or an unpinned download", () => {
    expect(body).toMatch(/CARGO_DENY_VERSION: "\d+\.\d+\.\d+"/);
    expect(body).toMatch(/cargo install cargo-deny --locked --version "\$CARGO_DENY_VERSION"/);
    expect(body).not.toMatch(/\b(curl|wget)\b/);
    for (const m of body.matchAll(/uses:\s*(\S+)/g)) expect(m[1], "only first-party actions, pinned to a commit").toMatch(/^actions\/[\w-]+@[0-9a-f]{40}$/);
  });

  it("is read-only: a read-only token at every level, no secret, no environment, nothing written", () => {
    expect(body).toMatch(/^permissions:\n {2}contents: read$/m);
    const jobs = body.slice(body.indexOf("\njobs:"));
    const names = [...jobs.matchAll(/^ {2}([\w-]+):\n {4}name:/gm)].map((m) => m[1]);
    expect(names).toEqual(["cargo-licenses", "cargo-advisories", "npm-audit"]);
    expect([...jobs.matchAll(/^ {4}permissions:\n {6}contents: read$/gm)]).toHaveLength(names.length);
    expect(body).not.toMatch(/secrets\.|environment:|: write|write-all|pull_request_target/);
    expect(body).not.toMatch(/persist-credentials: true/);
    expect([...body.matchAll(/uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n\s+persist-credentials: false/g)]).toHaveLength(names.length);
  });
});

describe("workflow lint tool", () => {
  const ci = read(".github", "workflows", "ci.yml");
  const body = code(ci);

  it("is pinned by checksum, and the download is verified before it is run", () => {
    expect(body).toMatch(/ACTIONLINT_SHA256: [0-9a-f]{64}\b/);
    const check = body.search(/sha256sum --check --strict/);
    const run = body.search(/\.\/actionlint /);
    expect(check).toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(check);
    expect(body.search(/curl /)).toBeLessThan(check);
  });

  it("is no longer installed from a moving tag", () => {
    expect(body).not.toMatch(/go install/);
    expect(body).not.toMatch(/actionlint@latest/);
  });
});
