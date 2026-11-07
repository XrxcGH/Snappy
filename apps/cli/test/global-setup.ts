/**
 * Runs once per test run, before any test file. It only makes an empty folder and tells every worker
 * where it is (see shared-runs.ts); it does no work itself, so a run of one test file stays quick.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

export default function setup(project: TestProject): () => void {
  const dir = mkdtempSync(join(tmpdir(), "snappy-shared-runs-"));
  project.provide("sharedRunsDir", dir);
  return () => rmSync(dir, { recursive: true, force: true });
}
