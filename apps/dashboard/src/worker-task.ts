/**
 * What the background reader does for one request: read the parts, then send progress, the chat
 * events in packed batches, and the rest of the result. Kept apart from the worker entry so it
 * runs under test with a plain function in place of postMessage.
 */
import { forgetMediaHandles } from "@snappy-export/core";
import { runImport } from "./import-pipeline.ts";
import { BATCH_EVENTS, packChats } from "./import-transfer.ts";
import type { WorkerReply } from "./import-transfer.ts";

export type Post = (reply: WorkerReply, transfer?: Transferable[]) => void;

export async function runWorkerTask(blobs: readonly Blob[], post: Post, batchEvents = BATCH_EVENTS): Promise<void> {
  try {
    // Nobody is waiting on a frame here, so there is nothing to yield to.
    const merged = await runImport(blobs, { onProgress: (progress) => post({ type: "progress", progress }), yieldToUi: async () => {} });
    // The page only counts Memories: file locations and links are dropped here, before they are copied across.
    const { chats, ...parsed } = forgetMediaHandles(merged);
    for (let from = 0; from < chats.length; from += batchEvents) {
      const batch = packChats(chats, from, Math.min(chats.length, from + batchEvents));
      post({ type: "chats", batch }, [batch.conversation.buffer, batch.kind.buffer, batch.flags.buffer, batch.at.buffer]);
    }
    post({ type: "done", parsed });
  } catch {
    // The reason can name a file or hold export text; the page only needs to know it failed.
    post({ type: "failed" });
  }
}
