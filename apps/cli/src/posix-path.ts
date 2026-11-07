/**
 * POSIX path rules as a PathPort, with no node: import. The in-app terminal uses it over its
 * virtual file system. Relative paths resolve against "/", since that file system has no
 * working folder.
 */
import type { PathPort } from "./ports.ts";

/** Segments of `path` with "." and empty parts removed and ".." applied. */
function segmentsOf(path: string, absolute: boolean): string[] {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!absolute) out.push("..");
    } else {
      out.push(seg);
    }
  }
  return out;
}

function normalize(path: string): string {
  if (path.length === 0) return ".";
  const absolute = path.startsWith("/");
  const trailing = path.endsWith("/");
  let body = segmentsOf(path, absolute).join("/");
  if (body === "" && !absolute) return trailing ? "./" : ".";
  if (body !== "" && trailing) body += "/";
  return (absolute ? "/" : "") + body;
}

function resolve(...parts: string[]): string {
  let resolved = "";
  for (let i = parts.length - 1; i >= 0 && !resolved.startsWith("/"); i--) {
    const part = parts[i] as string;
    if (part.length === 0) continue;
    resolved = resolved === "" ? part : `${part}/${resolved}`;
  }
  const full = resolved.startsWith("/") ? resolved : `/${resolved}`;
  return `/${segmentsOf(full, true).join("/")}`;
}

function dirname(path: string): string {
  if (path.length === 0) return ".";
  const hasRoot = path.startsWith("/");
  let end = -1;
  let matchedSlash = true;
  for (let i = path.length - 1; i >= 1; --i) {
    if (path[i] === "/") {
      if (!matchedSlash) {
        end = i;
        break;
      }
    } else {
      matchedSlash = false;
    }
  }
  if (end === -1) return hasRoot ? "/" : ".";
  if (hasRoot && end === 1) return "//";
  return path.slice(0, end);
}

function basename(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") end--;
  const start = end === 0 ? 0 : path.lastIndexOf("/", end - 1) + 1;
  return path.slice(start, end);
}

function relative(from: string, to: string): string {
  const a = segmentsOf(resolve(from), true);
  const b = segmentsOf(resolve(to), true);
  let common = 0;
  while (common < a.length && common < b.length && a[common] === b[common]) common++;
  return [...a.slice(common).map(() => ".."), ...b.slice(common)].join("/");
}

export const posixPath: PathPort = {
  sep: "/",
  resolve,
  join: (...parts) => {
    const joined = parts.filter((p) => p.length > 0).join("/");
    return joined === "" ? "." : normalize(joined);
  },
  dirname,
  basename,
  relative,
  isAbsolute: (path) => path.startsWith("/"),
};
