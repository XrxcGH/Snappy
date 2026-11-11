/**
 * The sample export as the files a command reads, so Run works while the sample data is showing. The bytes are the same made-up
 * export the dashboard's sample is built from (the later one of the two), generated in the page when first asked for and held in
 * memory only, never saved. Nothing here comes from a real account.
 */
import { syntheticExportZip } from "@snappy-export/core";
import { SAMPLE_NOW } from "../sample.ts";
import type { CommandSpec } from "./commands.ts";
import type { RunFile } from "./run-types.ts";

/** Named like the first part Snapchat hands out, so the commands treat it as a whole export. */
export const SAMPLE_ZIP_NAME = `mydata~${SAMPLE_NOW}.zip`;

/**
 * A command that only reads an export may be fed the sample. One that saves the history or asks for a passphrase never is, so
 * made-up friends cannot reach a person's saved history through a Run on the sample.
 */
export const canUseSample = (spec: CommandSpec): boolean => spec.needsFile && spec.effect !== "store" && !spec.needsPassphrase;

/**
 * Whether the command saves files into the output folder, so it has to extract them. The sample's Memories declare big sizes over
 * a few bytes (for the storage views), and a file like that cannot be extracted: it would fail as damaged.
 */
export const extractsFiles = (spec: CommandSpec): boolean => spec.effect === "folder";

/**
 * The sample export as one ZIP file, the same made-up one the dashboard shows. For a command that extracts files the Memories keep
 * their real tiny sizes instead of the declared ones, so every one of them saves.
 */
export function sampleRunFiles(spec?: CommandSpec): RunFile[] {
  const storageShowcase = spec === undefined || !extractsFiles(spec);
  const zip = syntheticExportZip({ now: SAMPLE_NOW, phase: 2, realisticMemories: true, storageShowcase });
  return [{ name: SAMPLE_ZIP_NAME, blob: new Blob([zip as BlobPart], { type: "application/zip" }) }];
}
