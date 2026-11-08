/**
 * The command line reads an unzipped export folder from disk (cli/src/folder-zip.ts). The app's command helper is
 * only given the ZIP files that were picked, so that code would travel in the page without ever running: the helper's
 * build swaps in a stub (src/terminal/stubs/folder-zip.stub.ts). Pinned here: the stub has every name the helper's
 * code imports and refuses to read a folder, and the built helper carries none of the folder writer.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as real from "../../cli/src/folder-zip.ts";
import * as stub from "../src/terminal/stubs/folder-zip.stub.ts";

const root = path.resolve(import.meta.dirname, "..");
let tmp = "";
let helper = "";

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), "snappy-folder-stub-"));
  const build = (await import(pathToFileURL(path.join(root, "build.mjs")).href)) as { buildDashboard: (o: { outDir: string }) => Promise<{ terminalWorkerSource: string }> };
  helper = (await build.buildDashboard({ outDir: path.join(tmp, "out") })).terminalWorkerSource;
}, 90_000);

afterAll(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true });
});

describe("the helper's stand-in for the folder reader", () => {
  it("has only names that the real module has, and the ones the command line's input code uses", async () => {
    expect(Object.keys(stub).sort()).toEqual(["findDataFiles", "folderReader"]);
    for (const name of Object.keys(stub)) expect(real, name).toHaveProperty(name);
    const inputs = await readFile(path.resolve(root, "..", "cli", "src", "inputs.ts"), "utf8");
    expect(/import \{([^}]*)\} from "\.\/folder-zip\.ts"/.exec(inputs)?.[1]?.split(",").map((n) => n.trim()).sort()).toEqual(["findDataFiles", "folderReader"]);
  });

  it("finds no data files in a folder, so a folder of nothing reads as before ('No .zip files'), and refuses to read one", async () => {
    await expect(stub.findDataFiles()).resolves.toEqual([]);
    await expect(stub.folderReader()).rejects.toThrow();
  });

  it("leaves the zip writer out of the built helper while the command line itself keeps it", async () => {
    // The writer's own limit message is a literal that appears nowhere else in the helper.
    expect(await readFile(path.resolve(root, "..", "cli", "src", "folder-zip.ts"), "utf8")).toContain('"too large"');
    expect(helper).not.toContain('"too large"');
    // The rest of the input code is still there: ZIP files are read as before.
    expect(helper).toContain("Snappy stopped unexpectedly");
  });
});
