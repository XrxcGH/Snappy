/**
 * A command session for tests that render views. Its runner cannot start a helper, so pressing Run says
 * "This browser cannot run commands here." instead of failing.
 */
import { createTerminalSession } from "../src/terminal/session.ts";
import type { TerminalSession } from "../src/terminal/session.ts";

export function testTerminal(): TerminalSession {
  return createTerminalSession({
    spawn: () => null,
    vault: { supported: () => false, read: async () => null, write: async () => undefined, clear: async () => undefined },
    vaultPhase: () => "locked",
    announce: () => undefined,
    coarse: false,
  });
}
