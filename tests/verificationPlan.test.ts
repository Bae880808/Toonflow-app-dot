import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { parseOptions, sameInventory, validateTestReport, additionalChecks, conclusion, coreWorkspaces } from "../scripts/verificationPlan.ts";

const sha = "a".repeat(40);
const report = " 3 pass\n 0 fail\n 9 expect() calls\nRan 3 tests across 1 file. [5ms]\n";
test("requires exact commits and rejects unknown or duplicate switches", () => {
  assert.equal(parseOptions(["--profile", "core", "--base", sha, "--head", sha]).head, sha);
  for (const args of [[], ["--profile", "core", "--base", "master", "--head", sha], ["--profile", "core", "--base", sha, "--head", sha, "--skip", "tests"], ["--profile", "core", "--base", sha, "--head", sha, "--profile", "core"]]) assert.throws(() => parseOptions(args));
});
test("fixed inventory rejects missing, additional and duplicate entries", () => {
  assert.equal(sameInventory(["b", "a"], ["a", "b"]), true);
  for (const actual of [["a"], ["a", "b", "c"], ["a", "a"]]) assert.equal(sameInventory(actual, ["a", "b"]), false);
  assert.equal(coreWorkspaces.length, 37);
  assert.equal(coreWorkspaces.includes("apps/desktop"), false);
});
test("accepts only a complete successful Bun test summary", () => {
  assert.equal(validateTestReport(report, 3), true);
  for (const invalid of ["", report.replace("3 pass", "2 pass"), report.replace("0 fail", "1 fail"), report.replace("3 tests", "2 tests"), report + " 1 skip\n", report + " 1 todo\n", report + report, " 0 pass\n 0 fail\nRan 0 tests across 1 file.\n"]) assert.equal(validateTestReport(invalid, 3), false);
  assert.equal(validateTestReport(report, 0), false);
});
test("unknown and shared runtime changes require human impact classification", () => {
  assert.deepEqual(additionalChecks(["packages/file/src/index.ts", "newRuntime.ts"]), ["humanImpactReview"]);
  assert.deepEqual(additionalChecks(["apps/desktop/src/index.ts"]), ["macArm64", "macX64", "windows"]);
  assert.deepEqual(additionalChecks(["apps/web/src/app.vue"]), ["uiPath"]);
});
test("incomplete checks never produce green or automatic merge eligibility", () => {
  assert.deepEqual(conclusion(false, ["uiPath"]), { result: "notVerified", exitCode: 2, autoMergeEligible: false });
  assert.equal(conclusion(true, []).exitCode, 1);
  assert.equal(conclusion(false, []).exitCode, 0);
  assert.equal(conclusion(false, []).autoMergeEligible, false);
});
test("the underlying test runner detects an intentional assertion failure", () => {
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", 'import { test } from "node:test"; import assert from "node:assert/strict"; test("intentional sentinel", () => assert.equal(1, 2));'], { encoding: "utf8", shell: false, timeout: 10000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /ERR_ASSERTION/);
});
