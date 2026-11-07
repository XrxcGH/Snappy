/**
 * Entry point of the background reader. build.mjs bundles it to text, and worker-runner.ts starts
 * it from a blob: URL. It has no network access: it inherits this page's policy (connect-src 'none').
 */
import type { StartRequest } from "./import-transfer.ts";
import { runWorkerTask } from "./worker-task.ts";

interface Scope {
  onmessage: ((event: { data: StartRequest }) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = self as unknown as Scope;

scope.onmessage = (event) => {
  const request = event.data;
  if (request?.type === "start") void runWorkerTask(request.blobs, (reply, transfer) => scope.postMessage(reply, transfer ?? []));
};
