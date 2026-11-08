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

/** The sample export as one ZIP file, the same made-up one the dashboard shows. */
export function sampleRunFiles(): RunFile[] {
  const zip = syntheticExportZip({ now: SAMPLE_NOW, phase: 2, realisticMemories: true, storageShowcase: true });
  return [{ name: SAMPLE_ZIP_NAME, blob: new Blob([zip as BlobPart], { type: "application/zip" }) }];
}
