/**
 * The page's side of a Run. It checks the argument list, starts one helper for the Run, relays what the
 * helper says, answers its questions, and ends the Run exactly once: when the command exits, when the
 * helper fails, or when a stop request runs out of grace and the helper is cut off.
 *
 *  - The page never parses text into a command: the argument list comes from the catalog.
 *  - Passphrase questions go to the person through `hooks.askSecret`. The answer is put in one message
 *    to the helper and dropped: it is not logged, stored or passed anywhere else.
 *  - The helper may ask for the saved history, but only the page decides: a read only for a command
 *    that uses it, a write only for a command that saves it and only while the dashboard has it locked
 *    (so the dashboard cannot write over the new file).
 */
import { checkArgv } from "./policy.ts";
import { parseFromWorker } from "./protocol.ts";
import type { FromWorker } from "./protocol.ts";
import { CANCEL_GRACE_MS } from "./run-types.ts";
import type { Channel, RunHandle, RunHooks, RunInput, RunResult, Runner, RunnerDeps } from "./run-types.ts";

/** The largest saved history the helper may write back (the real one is a few hundred KB at most). */
export const MAX_STORE_BYTES = 64 * 1024 * 1024;

export function createRunner(deps: RunnerDeps): Runner {
  let counter = 0;

  return {
    run(input: RunInput, hooks: RunHooks): RunHandle {
      const started = deps.now();
      const runId = `run-${++counter}`;
      let settled = false;
      let canceled = false;
      let channel: Channel | null = null;
      let cancelTimer: (() => void) | undefined;
      let filesSeen = false;
      const waiting = new Set<number>();

      let finish: (result: RunResult) => void = () => undefined;
      const done = new Promise<RunResult>((resolve) => (finish = resolve));

      const settle = (end: RunResult["end"], code: number | null): void => {
        if (settled) return;
        settled = true;
        cancelTimer?.();
        cancelTimer = undefined;
        waiting.clear();
        channel?.stop();
        finish({ end, code, ms: deps.now() - started });
      };

      const post = (message: Parameters<Channel["post"]>[0]): void => {
        if (settled) return;
        try {
          channel?.post(message);
        } catch {
          settle("failed", null);
        }
      };

      const blocked = input.spec.network || !checkArgv(input.argv).ok;
      if (blocked) {
        settle("blocked", null);
        return { done, cancel: () => undefined };
      }

      try {
        channel = deps.spawn();
      } catch {
        channel = null;
      }
      if (channel === null) {
        settle("failed", null);
        return { done, cancel: () => undefined };
      }

      const usesStore = input.spec.needsPassphrase || input.spec.effect === "store";

      const answerStore = async (message: Extract<FromWorker, { type: "store-read" | "store-write" }>): Promise<void> => {
        const id = message.id;
        if (message.type === "store-read") {
          if (!usesStore) return post({ type: "store-reply", id, ok: false, code: "EACCES" });
          try {
            post({ type: "store-reply", id, ok: true, bytes: await deps.vault.read() });
          } catch {
            post({ type: "store-reply", id, ok: false, code: "EIO" });
          }
          return;
        }
        // A write goes through only for a command that saves history, while the dashboard is not holding it open.
        if (input.spec.effect !== "store" || deps.vaultPhase() === "unlocked" || message.bytes.length > MAX_STORE_BYTES) {
          return post({ type: "store-reply", id, ok: false, code: "EACCES" });
        }
        try {
          await deps.vault.write(message.bytes);
          post({ type: "store-reply", id, ok: true });
        } catch {
          post({ type: "store-reply", id, ok: false, code: "EIO" });
        }
      };

      const handle = (raw: unknown): void => {
        if (settled) return;
        const message = parseFromWorker(raw);
        if (message === null) return;
        switch (message.type) {
          case "out":
            hooks.onOut(message.text);
            return;
          case "ask-secret": {
            const id = message.id;
            waiting.add(id);
            void hooks.askSecret(message.question).then(
              (value) => {
                // A prompt that was open when the Run was stopped is answered with "canceled" by the helper itself.
                if (settled || canceled || !waiting.delete(id)) return;
                post({ type: "secret", id, value });
              },
              () => {
                if (settled || canceled || !waiting.delete(id)) return;
                post({ type: "secret", id, value: null });
              },
            );
            return;
          }
          case "store-read":
          case "store-write":
            void answerStore(message);
            return;
          case "files":
            // Files arrive once, and only for a command that saves to the virtual folder.
            if (filesSeen || input.spec.effect !== "folder") return;
            filesSeen = true;
            hooks.onFiles(message.files);
            return;
          case "exit":
            settle(canceled && message.code === 130 ? "canceled" : "done", message.code);
            return;
        }
      };

      channel.onMessage(handle);
      channel.onFailure(() => settle("failed", null));

      post({ type: "run", runId, argv: input.argv, files: [...input.files], columns: input.columns, coarse: deps.coarse, outCap: deps.outCap });

      return {
        done,
        cancel() {
          if (settled || canceled) return;
          canceled = true;
          waiting.clear();
          post({ type: "cancel" });
          // A command that does not stop in time is cut off. Files it had not yet handed over are lost.
          cancelTimer = deps.setTimer(() => settle("terminated", 130), CANCEL_GRACE_MS);
        },
      };
    },
  };
}
