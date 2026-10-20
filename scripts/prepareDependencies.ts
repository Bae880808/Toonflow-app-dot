import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// CI preparation runs before workspace dependencies exist, using runner primitives.
function git(root: string, args: string[]) {
  return execFileSync("git", ["--no-pager", "-c", "core.fsmonitor=false", ...args], {
    cwd: root, encoding: "utf8", timeout: 10000, maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
}
function snapshot(root: string) {
  try {
    const dependencyPath = (path: string) => /(^|\/)(package\.json|bun\.lock)$/.test(path);
    const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(dependencyPath);
    if (untracked.length) throw new Error("Untracked dependency files");
    const paths = git(root, ["ls-files", "-z"]).split("\0")
      .filter(dependencyPath).sort();
    if (!paths.includes("bun.lock") || !paths.includes("package.json")) throw new Error("Required dependency files missing");
    const hashes = paths.map(path => [path, createHash("sha256").update(readFileSync(resolve(root, path))).digest("hex")]);
    return { paths, sha256: createHash("sha256").update(JSON.stringify(hashes)).digest("hex") };
  } catch { throw new Error("Dependency snapshot failed"); }
}
function requireCommitted(root: string) {
  const changed = git(root, ["diff", "--no-renames", "--no-ext-diff", "--no-textconv", "--name-only", "-z", "HEAD", "--"]).split("\0");
  if (changed.some(path => /(^|\/)(package\.json|bun\.lock)$/.test(path))) {
    throw new Error("Dependency files differ from HEAD");
  }
}
function install(root: string) {
  const result = spawnSync("bun", ["install", "--frozen-lockfile", "--ignore-scripts"], {
    cwd: root, shell: false, stdio: "inherit", timeout: 600000,
  });
  if (result.error || result.status !== 0) throw new Error(`Frozen dependency installation failed (${result.status ?? "no exit status"})`);
}
export function prepareDependencies(root: string, installer: (root: string) => void = install) {
  requireCommitted(root);
  const before = snapshot(root);
  try { installer(root); }
  finally {
    const after = snapshot(root);
    if (before.sha256 !== after.sha256) throw new Error("Dependency files changed during preparation");
    requireCommitted(root);
  }
  return { files: before.paths.length, sha256: before.sha256 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = fileURLToPath(new URL("../", import.meta.url));
    console.log(JSON.stringify({ preparation: "frozen dependencies; lifecycle scripts disabled", ...prepareDependencies(root) }));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
