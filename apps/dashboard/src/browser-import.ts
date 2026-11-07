/** The import runner the page uses: a background worker where the browser allows one, else the page itself. */
import { workerSource } from "snappy:worker";
import { runImport } from "./import-pipeline.ts";
import type { ImportRunner } from "./import-pipeline.ts";
import { spawnBlobWorker, workerRunner } from "./worker-runner.ts";

export const browserImport: ImportRunner = workerRunner(() => spawnBlobWorker(workerSource), runImport);
