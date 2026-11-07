/** Virtual module produced by build.mjs: license texts for the bundled fonts and library. */
declare module "snappy:licenses" {
  export const licenses: readonly {
    readonly name: string;
    readonly license: string;
    readonly copyright: string;
    readonly text: string;
  }[];
}

/** Virtual module produced by build.mjs: the background reader's code as text (started from a blob: URL). */
declare module "snappy:worker" {
  export const workerSource: string;
}
