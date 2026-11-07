/**
 * Guards for the release pipeline's trust boundaries. The rules are read from the workflow files themselves,
 * so a later edit cannot quietly put a signing secret into a job that runs build code, add a write permission
 * to the wrong job, drop a pinned SHA, or switch on pull_request_target.
 *
 * This is a plain-text check that relies on the files' own layout (two-space job keys under `jobs:`). It is a
 * tripwire for the mistakes that matter here, not a YAML validator: actionlint does that.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workflow = (name: string): string => readFileSync(path.join(repo, ".github", "workflows", name), "utf8");

/** The jobs that may hold a secret: they receive finished files and run no repository code. */
const SECRET_JOBS = ["sign-windows", "sign-macos", "sign-android", "release"];
/** The jobs that may use the 'release' environment (and so read its secrets). */
const ENVIRONMENT_JOBS = SECRET_JOBS;
/** The jobs that sign. They must never run build tooling or check out the repository. */
const SIGN_JOBS = ["sign-windows", "sign-macos", "sign-android"];

type Job = { name: string; lines: string[] };

/** Lines with comments and blank lines removed, so a comment that mentions a rule never trips it. */
function code(lines: string[]): string[] {
  return lines.filter((l) => l.trim() !== "" && !l.trim().startsWith("#"));
}

function split(text: string): { header: string[]; jobs: Job[] } {
  const lines = text.split(/\r?\n/);
  const at = lines.findIndex((l) => l === "jobs:");
  if (at < 0) return { header: lines, jobs: [] };
  const jobs: Job[] = [];
  let current: Job | null = null;
  for (const line of lines.slice(at + 1)) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      current = { name: m[1]!, lines: [] };
      jobs.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return { header: lines.slice(0, at), jobs };
}

/** Every rule violated by one workflow file, as readable sentences. Empty means the file is fine. */
function problems(file: string, text: string): string[] {
  const out: string[] = [];
  const { header, jobs } = split(text);
  const headerCode = code(header);
  const isRelease = file === "release.yml";
  const allCode = [...headerCode, ...jobs.flatMap((j) => code(j.lines))];

  if (allCode.some((l) => /pull_request_target/.test(l))) out.push(`${file}: uses pull_request_target`);

  for (const l of allCode) {
    const m = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(l);
    if (m && !m[1]!.startsWith("./") && !/@[0-9a-f]{40}$/.test(m[1]!)) out.push(`${file}: action not pinned to a full commit SHA: ${m[1]}`);
  }

  // Workflow-level permissions: read-only, and stated.
  const topPerm = /^permissions:\s*\n((?:[ ]{2}.*\n?)*)/m.exec(header.join("\n") + "\n");
  if (!topPerm) out.push(`${file}: no top-level permissions block`);
  else if (/write/.test(topPerm[1]!)) out.push(`${file}: top-level permissions include write`);
  else if (!/contents:\s*read/.test(topPerm[1]!)) out.push(`${file}: top-level permissions are not contents: read`);

  if (headerCode.some((l) => /secrets\./.test(l))) out.push(`${file}: a secret is referenced at workflow level`);

  for (const job of jobs) {
    const body = code(job.lines);
    const joined = body.join("\n");
    const mayHoldSecrets = isRelease && SECRET_JOBS.includes(job.name);

    if (!mayHoldSecrets && /secrets\.(?!GITHUB_TOKEN)/.test(joined)) out.push(`${file}: job ${job.name} references a secret`);
    if (/secrets:\s*inherit/.test(joined)) out.push(`${file}: job ${job.name} inherits all secrets`);
    if (/^ {4}environment:/m.test(joined) && !(isRelease && ENVIRONMENT_JOBS.includes(job.name))) out.push(`${file}: job ${job.name} uses an environment`);
    if (!/^ {4}permissions:/m.test(joined)) out.push(`${file}: job ${job.name} does not state its permissions`);

    const writes = body.filter((l) => /^\s+[a-z-]+:\s*write\s*$/.test(l)).map((l) => l.trim());
    const allowedWrites = !isRelease ? [] : job.name === "release" ? ["contents: write"] : job.name === "attest" ? ["id-token: write", "attestations: write"] : [];
    for (const w of writes) if (!allowedWrites.includes(w)) out.push(`${file}: job ${job.name} has write permission ${w}`);

    if (isRelease && SIGN_JOBS.includes(job.name)) {
      if (/actions\/checkout/.test(joined)) out.push(`${file}: signing job ${job.name} checks out the repository`);
      if (/\b(npm|npx|cargo|rustup|tauri|node|gradle|gradlew)\b/.test(joined)) out.push(`${file}: signing job ${job.name} runs build tooling`);
      if (!/^ {4}environment:\s*release\s*$/m.test(joined)) out.push(`${file}: signing job ${job.name} is not behind the release environment`);
      if (!/^ {4}permissions:\s*\{\}\s*$/m.test(joined)) out.push(`${file}: signing job ${job.name} should have permissions: {}`);
      if (!/needs\.verify\.outputs\.official == 'true'/.test(joined)) out.push(`${file}: signing job ${job.name} does not require an official run`);
      // The build artifact is untrusted. Names or contents taken from it must never reach the environment
      // that later steps (and their secrets) run under. A file name can hold newlines and so add variables.
      const firstSecret = joined.search(/\$\{\{[^}]*\bsecrets\b/);
      const beforeSecrets = firstSecret < 0 ? joined : joined.slice(0, firstSecret);
      if (!/Check the files from the build/.test(beforeSecrets)) out.push(`${file}: signing job ${job.name} does not check the build artifact before it reads a secret`);
    }
    if (isRelease && mayHoldSecrets && /GITHUB_(ENV|PATH)/.test(joined)) out.push(`${file}: job ${job.name} writes to GITHUB_ENV or GITHUB_PATH`);
    if (isRelease && job.name === "release") {
      if (!/needs\.verify\.outputs\.official == 'true'/.test(joined)) out.push(`${file}: release job does not require an official run`);
      if (/actions\/checkout|npm|cargo/.test(joined)) out.push(`${file}: release job runs repository or build code`);
    }
  }

  // Installing and building: no install scripts, locked dependencies.
  for (const l of allCode) {
    if (/\bnpm ci\b/.test(l) && !/--ignore-scripts/.test(l)) out.push(`${file}: npm ci without --ignore-scripts: ${l.trim()}`);
    if (/\bnpm install\b/.test(l)) out.push(`${file}: npm install instead of npm ci: ${l.trim()}`);
  }
  return out;
}

describe("workflow trust boundaries (the real files)", () => {
  for (const file of ["release.yml", "ci.yml", "desktop-smoke.yml"]) {
    it(`${file} breaks none of the rules`, () => {
      expect(problems(file, workflow(file))).toEqual([]);
    });
  }

  it("release.yml only runs for a tag push or by hand, and checks the tag is on main", () => {
    const text = workflow("release.yml");
    const on = /^on:\n((?:[ ]{2}.*\n|\n)*)/m.exec(text)![1]!;
    expect(on).not.toMatch(/pull_request|schedule|workflow_run|issue|\bpush:\s*\n\s+branches/);
    expect(on).toMatch(/tags:\s*\["v\*"\]/);
    expect(on).toMatch(/workflow_dispatch:/);
    const verify = split(text).jobs.find((j) => j.name === "verify")!;
    const body = code(verify.lines).join("\n");
    expect(body).toMatch(/fetch-depth:\s*0/);
    expect(body).toMatch(/git merge-base --is-ancestor HEAD "origin\/\$\{RELEASE_BRANCH\}"/);
    expect(body).toMatch(/\[ "\$EVENT_NAME" = "push" \] && \[ "\$REF_TYPE" = "tag" \]/);
  });

  it("only the build, sign and release jobs exist in the order the design needs", () => {
    const names = split(workflow("release.yml")).jobs.map((j) => j.name);
    expect(names).toEqual(["verify", "desktop", "android", "ios", "sign-windows", "sign-macos", "sign-android", "attest", "release"]);
  });

  it("never builds the test hooks (the dev-hooks feature keeps the WebView2 debugging variables)", () => {
    for (const file of ["release.yml", "desktop-smoke.yml", "ci.yml"]) expect(workflow(file)).not.toMatch(/dev-hooks/);
  });

  it("builds with locked dependencies", () => {
    expect(workflow("release.yml")).toMatch(/args\+=\(-- --locked\)/);
    expect(workflow("desktop-smoke.yml")).toMatch(/build --debug --no-bundle -- --locked/);
  });

  it("makes a missing Android file visible in the release notes", () => {
    const text = workflow("release.yml");
    expect(text).toMatch(/list_files "Android APK" "\*android\*\.apk" no/);
    expect(text).toMatch(/NOT ATTACHED/);
    expect(text).toMatch(/::warning::/);
  });
});

describe("the checker itself catches the mistakes it is for", () => {
  const good = workflow("release.yml");

  it("catches a secret added to a build job", () => {
    const bad = good.replace("  desktop:\n", "  desktop:\n    env:\n      LEAK: ${{ secrets.APPLE_CERTIFICATE }}\n");
    expect(problems("release.yml", bad).join("\n")).toMatch(/job desktop references a secret/);
  });

  it("catches an environment on a build job", () => {
    const bad = good.replace("  android:\n", "  android:\n    environment: release\n");
    expect(problems("release.yml", bad).join("\n")).toMatch(/job android uses an environment/);
  });

  it("catches contents: write on the wrong job and at workflow level", () => {
    const bad = good.replace("  attest:\n", "  attest:\n    permissions:\n      contents: write\n");
    expect(problems("release.yml", bad).join("\n")).toMatch(/job attest has write permission contents: write/);
    const bad2 = good.replace("permissions:\n  contents: read\n", "permissions:\n  contents: write\n");
    expect(problems("release.yml", bad2).join("\n")).toMatch(/top-level permissions include write/);
  });

  it("catches an unpinned action, pull_request_target and a signing job that builds", () => {
    expect(problems("ci.yml", workflow("ci.yml").replace(/actions\/setup-node@[0-9a-f]{40}/, "actions/setup-node@v4")).join("\n")).toMatch(/not pinned/);
    expect(problems("ci.yml", workflow("ci.yml").replace("  pull_request:", "  pull_request_target:")).join("\n")).toMatch(/pull_request_target/);
    const bad = good.replace("      - name: Sign the installers\n", "      - run: npm ci --ignore-scripts\n      - name: Sign the installers\n");
    expect(problems("release.yml", bad).join("\n")).toMatch(/signing job sign-windows runs build tooling/);
  });

  it("catches npm ci without --ignore-scripts and a secret in another workflow", () => {
    expect(problems("ci.yml", workflow("ci.yml").replace("- run: npm ci --ignore-scripts", "- run: npm ci")).join("\n")).toMatch(/npm ci without --ignore-scripts/);
    expect(problems("desktop-smoke.yml", workflow("desktop-smoke.yml").replace("    steps:\n", "    env:\n      X: ${{ secrets.FOO }}\n    steps:\n")).join("\n")).toMatch(/references a secret/);
  });

  it("catches a signing job that puts a value from the build artifact into GITHUB_ENV", () => {
    const bad = good.replace('codesign --verify --deep --strict --verbose=2 "$APP_PATH"\n', 'codesign --verify --deep --strict --verbose=2 "$APP_PATH"\n          echo "APP_PATH=$app" >> "$GITHUB_ENV"\n');
    expect(bad).not.toBe(good);
    expect(problems("release.yml", bad).join("\n")).toMatch(/job sign-macos writes to GITHUB_ENV or GITHUB_PATH/);
    const bad2 = good.replace('mv "$DMG_PATH" "out/$DMG_NAME"', 'echo "DMG_PATH=$x" >> "$GITHUB_PATH"');
    expect(problems("release.yml", bad2).join("\n")).toMatch(/job sign-macos writes to GITHUB_ENV or GITHUB_PATH/);
  });

  it("catches a signing job whose artifact check was removed", () => {
    const bad = good.replace("Check the files from the build and unpack the app (no secrets in this step)", "Unpack the app");
    expect(problems("release.yml", bad).join("\n")).toMatch(/signing job sign-macos does not check the build artifact/);
  });

  it("uses fixed names for the macOS app and disk image, and only a checked .dmg name travels on", () => {
    const mac = code(split(good).jobs.find((j) => j.name === "sign-macos")!.lines).join("\n");
    expect(mac).toMatch(/APP_PATH: work\/Snappy\.app/);
    expect(mac).toMatch(/DMG_PATH: out\/Snappy\.dmg/);
    expect(mac).toMatch(/safe='\^\[A-Za-z0-9\._-\]\+\$'/);
    expect(mac).toMatch(/tar -tf/);
    expect(mac).not.toMatch(/find work .*-name '\*\.app'/);
  });

  it("ignores a comment that only talks about the rules", () => {
    const withComment = good.replace("jobs:\n", "jobs:\n  # secrets.FOO and pull_request_target are only words here\n");
    expect(problems("release.yml", withComment)).toEqual([]);
  });
});
