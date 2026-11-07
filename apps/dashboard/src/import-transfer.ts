/**
 * Messages between the page and the background reader, and the packing of chat events for the
 * trip. A heavy history can hold millions of events; posting them as objects would make the page
 * spend seconds rebuilding them in one go. Packed into typed arrays (moved, not copied) and sent
 * in batches, each batch costs the page a few milliseconds, so it stays responsive. Events carry
 * metadata only (who, direction, kind, time), exactly what core already reduced them to.
 */
import type { ChatEvent, ParsedExport } from "@snappy-export/core";
import type { ImportProgress } from "./import-pipeline.ts";

/** Events per batch: about ten milliseconds of work to unpack. */
export const BATCH_EVENTS = 50_000;

export interface ChatBatch {
  /** Unique conversations and kinds of this batch; the arrays below index into them. */
  conversations: string[];
  kinds: string[];
  conversation: Uint32Array;
  kind: Uint32Array;
  /** Bit 0: group chat. Bit 1: sent by the account owner. */
  flags: Uint8Array;
  at: Float64Array;
}

export interface StartRequest {
  type: "start";
  /** The zip parts, in export order. Blobs are passed by reference, never copied. */
  blobs: Blob[];
}

export type WorkerReply =
  | { type: "progress"; progress: ImportProgress }
  | { type: "chats"; batch: ChatBatch }
  | { type: "done"; parsed: Omit<ParsedExport, "chats"> }
  /** Fixed outcome with no detail: nothing about the files is repeated. */
  | { type: "failed" };

/** Pack one batch of events. */
export function packChats(chats: readonly ChatEvent[], from: number, to: number): ChatBatch {
  const n = to - from;
  const conversations: string[] = [];
  const kinds: string[] = [];
  const conversationIndex = new Map<string, number>();
  const kindIndex = new Map<string, number>();
  const batch: ChatBatch = { conversations, kinds, conversation: new Uint32Array(n), kind: new Uint32Array(n), flags: new Uint8Array(n), at: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    const e = chats[from + i] as ChatEvent;
    let c = conversationIndex.get(e.conversation);
    if (c === undefined) {
      c = conversations.length;
      conversations.push(e.conversation);
      conversationIndex.set(e.conversation, c);
    }
    let k = kindIndex.get(e.kind);
    if (k === undefined) {
      k = kinds.length;
      kinds.push(e.kind);
      kindIndex.set(e.kind, k);
    }
    batch.conversation[i] = c;
    batch.kind[i] = k;
    batch.flags[i] = (e.isGroup ? 1 : 0) | (e.direction === "sent" ? 2 : e.direction === "unknown" ? 4 : 0);
    batch.at[i] = e.at;
  }
  return batch;
}

/** Append the events of a batch to `into`, in order. */
export function unpackChats(batch: ChatBatch, into: ChatEvent[]): void {
  for (let i = 0; i < batch.at.length; i++) {
    const flags = batch.flags[i] as number;
    into.push({
      conversation: batch.conversations[batch.conversation[i] as number] as string,
      isGroup: (flags & 1) !== 0,
      direction: (flags & 2) !== 0 ? "sent" : (flags & 4) !== 0 ? "unknown" : "received",
      kind: batch.kinds[batch.kind[i] as number] as string,
      at: batch.at[i] as number,
    });
  }
}
