import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { additionalChecks, conclusion, coreWorkspaces, expectedWorkspaces, fixedTests, parseOptions, sameInventory, validateTestReport } from "./verificationPlan.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const commands: { command: string[]; exitCode: number | null; output: string; cwd: string }[] = [];
const blocked: string[] = [];
let failed = false;
const metadata: Record<string, unknown> = { schemaVersion: 1, verifierVersion: "foundation1", generatedAt: new Date().toISOString(), platform: process.platform, arch: process.arch, bun: process.versions.bun ?? null, node: process.versions.node };
function command(executable: string, args: string[], timeout = 10000, env = process.env, cwd = root) {
  const result = spawnSync(executable, args, { cwd, shell: false, encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024, env });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  commands.push({ command: [executable, ...args], cwd, exitCode: result.status, output: executable === "git" ? "Git inspection output retained locally, not republished" : output });
  if (result.error || result.status !== 0) throw new Error(`${args[0]} failed: ${result.error?.message ?? result.status}`);
  return output;
}
function git(args: string[]) {
  return command("git", ["--no-pager", "-c", "core.fsmonitor=false", ...args], 10000, { ...process.env, GIT_OPTIONAL_LOCKS: "0" });
}
function trackedText(path: string) { return git(["show", `HEAD:${path}`]); }
function requireCondition(ok: boolean, message: string) { if (!ok) blocked.push(message); }
async function main() {
  const options = parseOptions(process.argv.slice(2));
  Object.assign(metadata, options);
  const head = git(["rev-parse", "HEAD"]).trim();
  metadata.actualHead = head;
  metadata.tree = git(["rev-parse", "HEAD^{tree}"]).trim();
  requireCondition(resolve(git(["rev-parse", "--show-toplevel"]).trim()) === resolve(root), "Repository root mismatch");
  requireCondition(head === options.head, "HEAD differs from requested candidate");
  requireCondition(git(["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"]) === "", "Dirty candidate: commit all candidate files before verification");
  for (const sha of [options.base, options.head]) requireCondition(git(["cat-file", "-t", sha]).trim() === "commit", "Base/head must be commits");
  git(["merge-base", "--is-ancestor", options.base, options.head]);
  git(["diff", "--no-ext-diff", "--no-textconv", "--check", options.base, options.head, "--"]);
  const paths = git(["ls-tree", "-r", "--name-only", "-z", head]).split("\0").filter(Boolean);
  requireCondition(!paths.includes(".agent-pause"), "Repository is paused");
  const changed = git(["diff", "--no-ext-diff", "--no-textconv", "--name-only", "-z", options.base, head, "--"]).split("\0").filter(Boolean);
  metadata.changedPaths = changed;
  metadata.additionalChecks = additionalChecks(changed);
  metadata.standards = ["AGENTS.md", "docs/code-standards.md", "LESSONS.md"].map(path => ({ path, sha256: createHash("sha256").update(trackedText(path)).digest("hex") }));
  metadata.lockSha256 = createHash("sha256").update(trackedText("bun.lock")).digest("hex");
  const manifests = paths.filter(path => /^(apps\/[^/]+|packages\/[^/]+|packages\/(nodes|tools|teams|ext)\/[^/]+)\/package\.json$/.test(path)).map(path => path.slice(0, -13));
  requireCondition(sameInventory(manifests, expectedWorkspaces), "Workspace inventory changed: review coverage before running");
  const manifest = JSON.parse(trackedText("package.json"));
  requireCondition(manifest.packageManager === "bun@1.3.14" && process.versions.bun === "1.3.14", "Bun 1.3.14 is required; this command does not install it");
  requireCondition(sameInventory(manifest.workspaces, ["apps/*", "packages/*", "packages/nodes/*", "packages/tools/*", "packages/teams/*", "packages/ext/*"]), "Workspace glob inventory changed");
  const testPaths = paths.filter(path => /^tests\/(unit|integration)\/.*\.(test|spec)\.[cm]?[jt]sx?$/.test(path));
  requireCondition(sameInventory(testPaths, fixedTests.map(test => test.path)), "Missing or unclassified test files");
  for (const workspace of coreWorkspaces) requireCondition(typeof JSON.parse(trackedText(`${workspace}/package.json`)).scripts?.typecheck === "string", `Missing typecheck script: ${workspace}`);
  requireCondition(typeof manifest.scripts?.["build:server"] === "string", "Missing standalone server build command");
  requireCondition(process.platform === "win32" && process.arch === "x64", "First approved core baseline requires Windows x64; other hosts are not substituted");
  if (blocked.length) return;

  // Environment preparation is separate. No package installation, SDK download, credentials or provider requests.
  const file = await import("@toonflow/file").catch(() => null);
  if (!file) { blocked.push("Locked workspace dependencies are not prepared"); return; }
  requireCondition(file.existsSync(resolve(root, "node_modules/typescript/bin/tsc")), "TypeScript compiler missing");
  requireCondition(file.existsSync(resolve(root, ".hutch/devkit/api/config/ElectrobunConfig.ts")), "Shared SDK config types missing");
  if (blocked.length) return;
  const sandbox = await file.mkdtemp(resolve(tmpdir(), "toonflowVerify"));
  const env = { ...process.env, TOONFLOW_DATA_DIR: sandbox, TOONFLOW_TEST_SANDBOX: "1", NODE_ENV: "production", NO_COLOR: "1" };
  try {
    for (const workspace of coreWorkspaces) command(process.execPath, ["run", "--cwd", workspace, "typecheck"], 120000, env);
    command(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "packages/providers/tsconfig.json", "--noEmit"], 120000, env);
    command(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tests/tsconfig.json", "--noEmit"], 120000, env);
    for (const test of fixedTests) {
      const output = command(process.execPath, ["test", `./${test.path.slice("tests/".length)}`], 120000, env, resolve(root, "tests"));
      if (!validateTestReport(output, test.count)) throw new Error(`Test count/report mismatch: ${test.path}`);
    }
    command(process.execPath, ["run", "build:server"], 900000, env);
    for (const path of ["build/server/index.js", "build/web/index.html", "build/mcp/stdio.js"]) {
      const bytes = await file.readFile(resolve(root, path));
      if (!bytes.length) throw new Error(`Empty artifact: ${path}`);
    }
    for (const path of ["build/nodes", "build/tools", "build/ext", "build/providers", "build/skills"]) {
      if (!(await file.readdir(resolve(root, path))).length) throw new Error(`Empty artifact directory: ${path}`);
    }
    if (changed.some(path => path.startsWith("apps/server/src/routes/"))) {
      command(process.execPath, ["run", "--cwd", "apps/server", "routes"], 120000, env);
      git(["diff", "--exit-code", "--", "apps/server/src/router.ts"]);
    }
    const candidateStatus = git(["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"]);
    const changedPaths = [...git(["diff", "--name-only", "-z", "HEAD", "--"]).split("\0"), ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")].filter(Boolean);
    metadata.candidateChanges = changedPaths.map(path => /^[A-Za-z0-9_.\/-]+$/.test(path) && !path.includes("..") ? path : `redacted:${createHash("sha256").update(path).digest("hex")}`);
    requireCondition(candidateStatus === "", "Checks changed the candidate tree");
    metadata.completed = "37 core workspaces, providers/tests types, fixed 19 tests, standalone build and artifact presence";
    // No self-signed approval switch. These omitted acceptance paths remain visible, not silently skipped.
    blocked.push("Required core coverage remains unimplemented: symlink escape, HTTP authorization/invalid request paths, built-server/browser persistence path");
    blocked.push("Human review required: complete UI evidence and exact dev integration candidate; build/artifact presence is not runtime verification");
    if (options.profile !== "core") blocked.push(`${options.profile} installation/runtime profile is not implemented`);
    for (const check of additionalChecks(changed)) blocked.push(`Additional impact validation required: ${check}`);
  } finally { await file.rm(sandbox, { recursive: true, force: true }); }
}
try { await main(); }
catch (error) { failed = true; metadata.error = error instanceof Error ? error.message : String(error); }
const result = conclusion(failed, blocked);
console.log(JSON.stringify({ ...metadata, ...result, blocked, commands }, null, 2));
process.exitCode = result.exitCode;
