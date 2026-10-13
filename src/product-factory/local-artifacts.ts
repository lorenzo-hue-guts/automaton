import fs from "node:fs";
import path from "node:path";
import { buildHash } from "./build-store.js";
import type { BuildArtifact } from "./build-types.js";
/** Reject traversal and symlinks, including ancestor/root symlinks. No shell or VM transport. */
export function artifactPath(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw new Error("Unsafe artifact path");
  const base = path.resolve(root), target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) throw new Error("Artifact escapes build workspace");
  const parts = target.split(path.sep);
  let current = path.parse(target).root;
  for (const part of parts.filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Symlink artifacts are forbidden"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return target;
}
export function writeArtifact(root: string, relative: string, content: string | Uint8Array): BuildArtifact {
  const target = artifactPath(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, content); } finally { fs.closeSync(fd); }
  return inspectArtifact(root, relative);
}
export function inspectArtifact(root: string, relative: string): BuildArtifact {
  const target = artifactPath(root, relative), stat = fs.statSync(target);
  if (!stat.isFile() || stat.size > 5_000_000) throw new Error("Invalid artifact");
  const content = fs.readFileSync(target);
  return { path: relative, sha256: buildHash(content), size: stat.size };
}
export function readArtifact(root: string, relative: string): string { inspectArtifact(root, relative); return fs.readFileSync(artifactPath(root, relative), "utf8"); }
