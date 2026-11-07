/** The shared run folder: a result is made once per run, and a failure only costs the waiting worker time. */
import { describe, expect, it } from "vitest";
import { sharedRuns } from "./shared-runs.ts";

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
let counter = 0;
const uniqueKey = (label: string): string => `test-${label}-${process.pid}-${counter++}`;

describe("sharedRuns", () => {
  it("makes a result once when callers ask at the same time, and hands every caller the same value", async () => {
    const key = uniqueKey("once");
    let made = 0;
    const make = async (): Promise<{ n: number }> => {
      made++;
      await pause(300);
      return { n: 42 };
    };
    const results = await Promise.all([sharedRuns(key, make), sharedRuns(key, make), sharedRuns(key, make)]);
    expect(results).toEqual([{ n: 42 }, { n: 42 }, { n: 42 }]);
    expect(made).toBe(1);
    // A later caller takes the saved value without making it again.
    expect(await sharedRuns(key, make)).toEqual({ n: 42 });
    expect(made).toBe(1);
  });

  it("lets a waiting caller make the result itself when the first one fails", async () => {
    const key = uniqueKey("fail");
    let made = 0;
    const failing = async (): Promise<string> => {
      made++;
      await pause(200);
      throw new Error("first caller failed");
    };
    const working = async (): Promise<string> => {
      made++;
      return "made by the second caller";
    };
    const first = sharedRuns(key, failing);
    await pause(20);
    const second = sharedRuns(key, working);
    await expect(first).rejects.toThrow("first caller failed");
    expect(await second).toBe("made by the second caller");
    expect(made).toBe(2);
  });
});
