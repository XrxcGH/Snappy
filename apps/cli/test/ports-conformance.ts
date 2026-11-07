/**
 * A shared suite for file system ports. The Node adapter runs it here; the dashboard's virtual
 * file system runs the same suite, so both behave alike for the calls a command makes.
 * Synthetic bytes only.
 */
import { describe, expect, it } from "vitest";
import { fsError } from "../src/errors.ts";
import type { FsPort, PathPort } from "../src/ports.ts";

export interface PortsUnderTest {
  fs: FsPort;
  path: PathPort;
  /** A writable, empty folder that exists. */
  root: string;
}

const bytes = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 7) % 251);

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return typeof e === "object" && e !== null && "code" in e ? String((e as { code: unknown }).code) : "no-code";
  }
}

export function portsConformance(label: string, make: () => Promise<PortsUnderTest>): void {
  describe(`ports conformance: ${label}`, () => {
    it("stats files, folders and missing paths", async () => {
      const { fs, path, root } = await make();
      await fs.writeFileAtomic(path.join(root, "a", "f.bin"), bytes(10), { durable: false });
      const file = await fs.stat(path.join(root, "a", "f.bin"));
      expect(file).toMatchObject({ isFile: true, isDirectory: false, size: 10 });
      expect(Number.isFinite(file.mtimeMs)).toBe(true);
      expect(await fs.stat(path.join(root, "a"))).toMatchObject({ isFile: false, isDirectory: true });
      expect(await codeOf(fs.stat(path.join(root, "missing")))).toBe("ENOENT");
    });

    it("lists a folder with file and folder flags", async () => {
      const { fs, path, root } = await make();
      await fs.writeFileAtomic(path.join(root, "x.zip"), bytes(3), { durable: false });
      await fs.mkdir(path.join(root, "sub"), { recursive: true });
      const entries = (await fs.readDir(root)).sort((a, b) => a.name.localeCompare(b.name));
      expect(entries).toEqual([
        { name: "sub", isFile: false, isDirectory: true },
        { name: "x.zip", isFile: true, isDirectory: false },
      ]);
      expect(await codeOf(fs.readDir(path.join(root, "nope")))).toBe("ENOENT");
    });

    it("reads exact ranges and rejects a range past the end", async () => {
      const { fs, path, root } = await make();
      const file = path.join(root, "bytes.bin");
      await fs.writeFileAtomic(file, bytes(1000), { durable: false });
      const reader = await fs.openRead(file);
      try {
        expect(reader.size).toBe(1000);
        expect([...(await reader.read(10, 15))]).toEqual([...bytes(1000).subarray(10, 15)]);
        expect((await reader.read(5, 5)).length).toBe(0);
        expect((await reader.read(990, 1000)).length).toBe(10);
        await expect(reader.read(0, 1010)).rejects.toBeInstanceOf(RangeError);
      } finally {
        await reader.close();
      }
      expect(await codeOf(fs.openRead(path.join(root, "missing.zip")))).toBe("ENOENT");
    });

    it("writes whole files, creates parent folders and replaces an existing file", async () => {
      const { fs, path, root } = await make();
      const file = path.join(root, "deep", "er", "out.bin");
      await fs.writeFileAtomic(file, bytes(5));
      expect([...(await fs.readFile(file))]).toEqual([...bytes(5)]);
      await fs.writeFileAtomic(file, bytes(2));
      expect([...(await fs.readFile(file))]).toEqual([...bytes(2)]);
      // No temp file is left in the folder.
      expect((await fs.readDir(path.dirname(file))).map((e) => e.name)).toEqual(["out.bin"]);
    });

    it("renames and removes files, but never a folder", async () => {
      const { fs, path, root } = await make();
      const a = path.join(root, "a.bin");
      const b = path.join(root, "b.bin");
      await fs.writeFileAtomic(a, bytes(4), { durable: false });
      await fs.rename(a, b);
      expect(await codeOf(fs.stat(a))).toBe("ENOENT");
      expect((await fs.stat(b)).size).toBe(4);
      await fs.remove(b);
      expect(await codeOf(fs.stat(b))).toBe("ENOENT");
      expect(await codeOf(fs.remove(b))).toBe("ENOENT");
      await fs.mkdir(path.join(root, "keep"), { recursive: true });
      expect(["EISDIR", "EPERM", "EACCES"]).toContain(await codeOf(fs.remove(path.join(root, "keep"))));
      expect((await fs.stat(path.join(root, "keep"))).isDirectory).toBe(true);
    });

    it("sets a file time only when it says it can", async () => {
      const { fs, path, root } = await make();
      const file = path.join(root, "t.bin");
      await fs.writeFileAtomic(file, bytes(1), { durable: false });
      const when = Date.UTC(2020, 5, 6, 7, 8, 10);
      const ok = await fs.setMtime(file, when);
      if (fs.setsFileTimes) {
        expect(ok).toBe(true);
        expect(Math.abs((await fs.stat(file)).mtimeMs - when)).toBeLessThanOrEqual(2000);
      } else {
        expect(ok).toBe(false);
      }
    });

    it("makes unique temp folders", async () => {
      const { fs, path, root } = await make();
      const a = await fs.makeTempDir(path.join(root, "demo-"));
      const b = await fs.makeTempDir(path.join(root, "demo-"));
      expect(a).not.toBe(b);
      expect((await fs.stat(a)).isDirectory).toBe(true);
      expect(path.dirname(a)).toBe(path.dirname(path.join(root, "demo-")));
    });

    it("raises errors fsError can turn into calm messages without the system text", async () => {
      const { fs, path, root } = await make();
      let caught: unknown;
      try {
        await fs.readFile(path.join(root, "missing.bin"));
      } catch (e) {
        caught = e;
      }
      expect(fsError(caught, "open", "x").code).toBe("not-found");
    });
  });
}
