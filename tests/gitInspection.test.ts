import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../scripts/verify.ts", import.meta.url), "utf8");
// Exercise the actual helpers without starting the platform-specific acceptance run.
const helpers = stripTypeScriptTypes(source.slice(source.indexOf("function command("), source.indexOf("function trackedText(")));
function fixture(run: (root: string, env: NodeJS.ProcessEnv, git: (args: string[]) => string) => void) {
  const root = mkdtempSync(join(tmpdir(), "gitInspection"));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: join(root, "globalConfig"), GIT_CONFIG_COUNT: "0" };
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd: root, env, encoding: "utf8", shell: false });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  try {
    writeFileSync(env.GIT_CONFIG_GLOBAL, "[core]\n\tautocrlf = true\n\teol = crlf\n");
    git(["init"]);
    git(["config", "user.name", "Fixture"]);
    git(["config", "user.email", "fixture@example.invalid"]);
    writeFileSync(join(root, "generated.ts"), "export {};\n");
    git(["-c", "core.autocrlf=false", "add", "generated.ts"]);
    git(["-c", "commit.gpgsign=false", "commit", "-m", "Fixture"]);
    rmSync(join(root, "generated.ts"));
    git(["checkout", "--", "generated.ts"]);
    writeFileSync(join(root, "generated.ts"), "export {};\n");
    run(root, env, git);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("Git warnings are not parsed as changed paths and Git logs remain redacted", () => fixture((root, env) => {
  const args = ["diff", "--name-only", "-z", "HEAD", "--"];
  const raw = spawnSync("git", args, { cwd: root, env, encoding: "utf8", shell: false });
  assert.equal(raw.status, 0);
  assert.equal(raw.stdout, "");
  assert.notEqual(raw.stderr, "", "fixture must produce a real Git EOL warning");
  const commands: { output: string }[] = [];
  const inspect = runInNewContext(`${helpers}\ngit`, { spawnSync, root, process: { env }, commands });
  assert.deepEqual(inspect(args).split("\0").filter(Boolean), []);
  assert.equal(commands[0].output, "Git inspection output retained locally, not republished");
}));

test("real changed paths and nonzero Git exits remain visible", () => fixture((root, env) => {
  const inspect = runInNewContext(`${helpers}\ngit`, { spawnSync, root, process: { env }, commands: [] });
  writeFileSync(join(root, "generated.ts"), "export const changed = true;\n");
  assert.deepEqual(inspect(["diff", "--name-only", "-z", "HEAD", "--"]).split("\0").filter(Boolean), ["generated.ts"]);
  assert.notEqual(inspect(["status", "--porcelain=v1", "--untracked-files=all", "--ignore-submodules=none"]), "");
  assert.throws(() => inspect(["rev-parse", "--verify", "refs/heads/nonexistentFixtureBranch"]), /failed/);
}));

test("non-Git commands retain both output streams for test report validation", () => {
  const commands: { output: string }[] = [];
  const command = runInNewContext(`${helpers}\ncommand`, { spawnSync, root: tmpdir(), process, commands });
  assert.equal(command(process.execPath, ["--eval", 'process.stdout.write("stdout"); process.stderr.write("stderr");']), "stdoutstderr");
  assert.equal(commands[0].output, "stdoutstderr");
});

test("workflow checkout uses LF even with a Windows-style global Git configuration", () => fixture((root, env, git) => {
  const workflow = readFileSync(new URL("../.github/workflows/verification.yml", import.meta.url), "utf8");
  const jobEnv = workflow.match(/^    env:\n((?:^      .*\n)+)/m)?.[1] ?? "";
  for (const match of jobEnv.matchAll(/^      (GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)): ['"]?([^'"\n]+)['"]?$/gm)) env[match[1]] = match[2];
  // Replace only the disposable fixture checkout, never the candidate repository.
  rmSync(join(root, "generated.ts"));
  git(["checkout", "--", "generated.ts"]);
  assert.equal(readFileSync(join(root, "generated.ts"), "utf8"), "export {};\n");
  writeFileSync(join(root, "generated.ts"), "export {};\n");
  assert.equal(git(["status", "--porcelain=v1", "--untracked-files=no"]), "");
  writeFileSync(join(root, "generated.ts"), "export const changed = true;\n");
  assert.match(git(["status", "--porcelain=v1", "--untracked-files=no"]), /generated\.ts/);
  assert.equal(readFileSync(env.GIT_CONFIG_GLOBAL!, "utf8"), "[core]\n\tautocrlf = true\n\teol = crlf\n");
}));
