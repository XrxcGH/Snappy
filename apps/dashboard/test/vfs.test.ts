import { describe, expect, it } from "vitest";
import { posixPath } from "../src/terminal/cli-api.ts";
import { LEDGER_FILE, createVfs } from "../src/terminal/vfs.ts";
import type { StoreBridge } from "../src/terminal/vfs.ts";
import { portsConformance } from "../../cli/test/ports-conformance.ts";

const blobOf = (text: string, name = "x.zip"): { name: string; blob: Blob } => ({ name, blob: new Blob([text]) });

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as { code?: string }).code ?? "no-code";
  }
}

let folder = 0;

// The same suite the Node adapter passes, run against the in-app file system on its writable folder.
portsConformance("in-app file system (/out)", async () => {
  const { fs } = createVfs({ files: [], outCap: 64 * 1024 * 1024 });
  const root = `/out/case-${++folder}`;
  await fs.mkdir(root, { recursive: true });
  return { fs, path: posixPath, root };
});

portsConformance("in-app file system (/tmp)", async () => {
  const { fs } = createVfs({ files: [], outCap: 1024 });
  const root = `/tmp/case-${++folder}`;
  await fs.mkdir(root, { recursive: true });
  return { fs, path: posixPath, root };
});

describe("mount routing", () => {
  const { fs } = createVfs({ files: [blobOf("hello"), blobOf("again", "y.zip")], outCap: 1024 });

  it("serves only /in, /out, /tmp and /app", async () => {
    expect((await fs.readDir("/")).map((e) => e.name).sort()).toEqual(["app", "in", "out", "tmp"]);
    for (const bad of ["/etc/passwd", "/home/me", "/", "C:\\Windows\\win.ini", "relative.zip", "", "/input/x", "/outside", "/tmpfile"]) {
      if (bad === "/") continue;
      expect(await codeOf(fs.readFile(bad)), bad).toBe("EACCES");
    }
    expect(await codeOf(fs.readFile("/in/a\0b"))).toBe("EACCES");
  });

  it("removes .. before choosing a place, so nothing climbs out", async () => {
    expect(await codeOf(fs.readFile("/in/../app/.snappy/ledger.sealed"))).toBe("ENOENT");
    expect(await codeOf(fs.readFile("/in/../../etc/passwd"))).toBe("EACCES");
    expect(await codeOf(fs.writeFileAtomic("/out/../in/x.zip", new Uint8Array(1)))).toBe("EACCES");
    expect(await codeOf(fs.writeFileAtomic("/out/../app/other", new Uint8Array(1)))).toBe("EACCES");
    expect(new TextDecoder().decode(await fs.readFile("/in/./x.zip"))).toBe("hello");
  });

  it("never moves a file from one place to another", async () => {
    await fs.writeFileAtomic("/tmp/a.bin", new Uint8Array([1]));
    expect(await codeOf(fs.rename("/tmp/a.bin", "/out/a.bin"))).toBe("EACCES");
    expect(await codeOf(fs.rename("/in/x.zip", "/tmp/x.zip"))).toBe("EACCES");
  });
});

describe("/in", () => {
  it("lists the picked files flat, names duplicates with (2), and is read only", async () => {
    const { fs } = createVfs({ files: [blobOf("1", "a.zip"), blobOf("2", "a.zip"), blobOf("3", "a.zip"), blobOf("4", "no-extension"), blobOf("5", "no-extension"), blobOf("6", "dir/with\\slash.zip")], outCap: 1024 });
    expect((await fs.readDir("/in")).map((e) => e.name)).toEqual(["a.zip", "a (2).zip", "a (3).zip", "no-extension", "no-extension (2)", "dir_with_slash.zip"]);
    expect(await codeOf(fs.writeFileAtomic("/in/new.zip", new Uint8Array(1)))).toBe("EACCES");
    expect(await codeOf(fs.mkdir("/in/sub", { recursive: true }))).toBe("EACCES");
    expect(await codeOf(fs.remove("/in/a.zip"))).toBe("EACCES");
    expect(await codeOf(fs.rename("/in/a.zip", "/in/b.zip"))).toBe("EACCES");
    expect(await codeOf(fs.setMtime("/in/a.zip", 1))).toBe("EACCES");
    expect(await codeOf(fs.stat("/in/a.zip/inner"))).toBe("ENOTDIR");
    expect(await codeOf(fs.stat("/in/missing.zip"))).toBe("ENOENT");
  });

  it("reads byte ranges lazily from the Blob and reports its size and date", async () => {
    const file = new File(["0123456789"], "n.zip", { lastModified: 1_700_000_000_000 });
    const { fs } = createVfs({ files: [{ name: "n.zip", blob: file }], outCap: 1024 });
    expect(await fs.stat("/in/n.zip")).toMatchObject({ isFile: true, size: 10, mtimeMs: 1_700_000_000_000 });
    const reader = await fs.openRead("/in/n.zip");
    expect(new TextDecoder().decode(await reader.read(2, 5))).toBe("234");
    await expect(reader.read(5, 11)).rejects.toBeInstanceOf(RangeError);
  });
});

describe("/out", () => {
  it("holds files up to its cap, then says the disk is full", async () => {
    const { fs, collectOut } = createVfs({ files: [], outCap: 10 });
    await fs.writeFileAtomic("/out/a.bin", new Uint8Array(6));
    expect(await codeOf(fs.writeFileAtomic("/out/b.bin", new Uint8Array(5)))).toBe("ENOSPC");
    // Replacing a file counts the difference, and removing one gives its space back.
    await fs.writeFileAtomic("/out/a.bin", new Uint8Array(10));
    await fs.remove("/out/a.bin");
    await fs.writeFileAtomic("/out/b.bin", new Uint8Array(10));
    expect(collectOut().map((f) => f.path)).toEqual(["b.bin"]);
  });

  it("collects files with paths inside /out and the file times that were set", async () => {
    const { fs, collectOut } = createVfs({ files: [], outCap: 1024 });
    await fs.writeFileAtomic("/out/memories/2021/a.jpg", new Uint8Array([1, 2]));
    await fs.setMtime("/out/memories/2021/a.jpg", 1_600_000_000_000);
    await fs.writeFileAtomic("/tmp/not-out.bin", new Uint8Array([9]));
    expect(collectOut()).toEqual([{ path: "memories/2021/a.jpg", bytes: new Uint8Array([1, 2]), mtimeMs: 1_600_000_000_000 }]);
  });

  it("will not put a file where a folder is, or a folder under a file", async () => {
    const { fs } = createVfs({ files: [], outCap: 1024 });
    await fs.mkdir("/out/d", { recursive: true });
    await fs.writeFileAtomic("/out/f", new Uint8Array(1));
    expect(await codeOf(fs.writeFileAtomic("/out/d", new Uint8Array(1)))).toBe("EISDIR");
    expect(await codeOf(fs.writeFileAtomic("/out/f/inner", new Uint8Array(1)))).toBe("ENOTDIR");
    expect(await codeOf(fs.mkdir("/out/f/sub", { recursive: true }))).toBe("ENOTDIR");
  });
});

describe("/app", () => {
  function bridge(initial: Uint8Array | null): StoreBridge & { reads: number; writes: Uint8Array[] } {
    const state = { reads: 0, writes: [] as Uint8Array[], current: initial };
    return {
      get reads() {
        return state.reads;
      },
      get writes() {
        return state.writes;
      },
      async read() {
        state.reads++;
        return state.current;
      },
      async write(bytes) {
        state.writes.push(bytes);
        state.current = bytes;
      },
    };
  }

  it("shows only the one sealed file, and nothing for the older keep-list file", async () => {
    const store = bridge(new Uint8Array([7, 7, 7]));
    const { fs } = createVfs({ files: [], outCap: 1024, store });
    expect([...(await fs.readFile(LEDGER_FILE))]).toEqual([7, 7, 7]);
    expect(await fs.stat(LEDGER_FILE)).toMatchObject({ isFile: true, size: 3 });
    expect(await codeOf(fs.stat("/app/.snappy/ledger.allowlist.sealed"))).toBe("ENOENT");
    expect(await codeOf(fs.readFile("/app/.snappy/other"))).toBe("ENOENT");
    expect((await fs.readDir("/app/.snappy")).map((e) => e.name)).toEqual(["ledger.sealed"]);
    expect(store.reads).toBe(1); // read once and kept for the run
  });

  it("writes only the sealed file, and refuses every other write", async () => {
    const store = bridge(null);
    const { fs } = createVfs({ files: [], outCap: 1024, store });
    expect(await codeOf(fs.stat(LEDGER_FILE))).toBe("ENOENT");
    await fs.mkdir("/app/.snappy", { recursive: true });
    await fs.writeFileAtomic(LEDGER_FILE, new Uint8Array([1, 2, 3]));
    expect(store.writes).toHaveLength(1);
    expect([...(await fs.readFile(LEDGER_FILE))]).toEqual([1, 2, 3]);
    for (const path of ["/app/.snappy/ledger.allowlist.sealed", "/app/.snappy/ledger.sealed.lock", "/app/x", "/app/.snappy/sub/ledger.sealed"]) {
      expect(await codeOf(fs.writeFileAtomic(path, new Uint8Array(1))), path).toBe("EACCES");
    }
    expect(await codeOf(fs.remove(LEDGER_FILE))).toBe("EACCES");
    expect(await codeOf(fs.rename(LEDGER_FILE, "/app/.snappy/b"))).toBe("EACCES");
    expect(await codeOf(fs.mkdir("/app/other", { recursive: true }))).toBe("EACCES");
    expect(store.writes).toHaveLength(1);
  });

  it("has nothing without a bridge", async () => {
    const { fs } = createVfs({ files: [], outCap: 1024 });
    expect(await codeOf(fs.stat(LEDGER_FILE))).toBe("ENOENT");
    expect(await codeOf(fs.writeFileAtomic(LEDGER_FILE, new Uint8Array(1)))).toBe("EACCES");
  });
});

describe("stopping", () => {
  it("fails every call with a calm canceled error once the signal fires", async () => {
    const controller = new AbortController();
    const { fs } = createVfs({ files: [blobOf("data")], outCap: 1024, signal: controller.signal });
    const reader = await fs.openRead("/in/x.zip");
    expect((await reader.read(0, 2)).length).toBe(2);
    controller.abort();
    for (const call of [() => reader.read(0, 1), () => fs.stat("/in/x.zip"), () => fs.readFile("/in/x.zip"), () => fs.writeFileAtomic("/out/a", new Uint8Array(1)), () => fs.readDir("/in")]) {
      await expect(call()).rejects.toMatchObject({ code: "canceled", exitCode: 130 });
    }
  });
});
