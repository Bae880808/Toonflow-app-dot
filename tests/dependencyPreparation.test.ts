import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { prepareDependencies } from "../scripts/prepareDependencies.ts";

function fixture(run: (root: string, git: (...args: string[]) => void) => void) {
  const root = mkdtempSync(join(tmpdir(), "dependencyGuard"));
  const git = (...args: string[]) => { execFileSync("git", args, { cwd: root, stdio: "pipe" }); };
  try {
    git("init");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "core.autocrlf", "false");
    mkdirSync(join(root, "apps/example"), { recursive: true });
    writeFileSync(join(root, "package.json"), '{"name":"root"}\n');
    writeFileSync(join(root, "apps/example/package.json"), '{"name":"example"}\n');
    writeFileSync(join(root, "bun.lock"), '{}\n');
    mkdirSync(join(root, "compat/example"), { recursive: true });
    writeFileSync(join(root, "compat/example/bun.lock"), '{}\n');
    git("add", ".");
    git("-c", "commit.gpgsign=false", "commit", "-m", "Fixture");
    run(root, git);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test("unchanged dependency files pass the preparation guard", () => fixture(root => {
  let called = 0;
  const result = prepareDependencies(root, () => { called++; });
  assert.equal(called, 1);
  assert.equal(result.files, 4);
  assert.match(result.sha256, /^[a-f0-9]{64}$/);
}));
for (const path of ["bun.lock", "compat/example/bun.lock", "package.json", "apps/example/package.json"]) {
  test(`installer mutation of ${path} fails the guard`, () => fixture(root => {
    assert.throws(() => prepareDependencies(root, () => writeFileSync(join(root, path), '{"changed":true}\n')), /Dependency files changed/);
  }));
}
test("deleting a tracked manifest fails the guard", () => fixture(root => {
  assert.throws(() => prepareDependencies(root, () => rmSync(join(root, "apps/example/package.json"))), /Dependency snapshot failed/);
}));
test("staging a new manifest fails the inventory guard", () => fixture((root, git) => {
  assert.throws(() => prepareDependencies(root, () => {
    mkdirSync(join(root, "apps/new"));
    writeFileSync(join(root, "apps/new/package.json"), '{}\n');
    git("add", "apps/new/package.json");
  }), /Dependency files changed/);
}));
test("dirty dependency input is rejected before installing", () => fixture(root => {
  writeFileSync(join(root, "bun.lock"), '{"dirty":true}\n');
  let called = false;
  assert.throws(() => prepareDependencies(root, () => { called = true; }), /Dependency files differ from HEAD/);
  assert.equal(called, false);
}));
test("installer failure is never converted to success", () => fixture(root => {
  assert.throws(() => prepareDependencies(root, () => { throw new Error("Install failed"); }), /Install failed/);
}));
test("post-install mutation is checked even when installation fails", () => fixture(root => {
  assert.throws(() => prepareDependencies(root, () => {
    writeFileSync(join(root, "bun.lock"), '{"changed":true}\n');
    throw new Error("Install failed");
  }), /Dependency files changed/);
}));

test("new unstaged manifest is rejected after preparation", () => fixture(root => {
  assert.throws(() => prepareDependencies(root, () => {
    mkdirSync(join(root, "apps/new"));
    writeFileSync(join(root, "apps/new/package.json"), '{}\n');
  }), /Dependency snapshot failed/);
}));

test("staged deletion is rejected before installing", () => fixture((root, git) => {
  git("rm", "apps/example/package.json");
  let called = false;
  assert.throws(() => prepareDependencies(root, () => { called = true; }), /Dependency files differ from HEAD/);
  assert.equal(called, false);
}));
test("untracked manifest input is rejected before installing", () => fixture(root => {
  mkdirSync(join(root, "apps/new"));
  writeFileSync(join(root, "apps/new/package.json"), '{}\n');
  let called = false;
  assert.throws(() => prepareDependencies(root, () => { called = true; }), /Dependency snapshot failed/);
  assert.equal(called, false);
}));

test("staged rename away from manifest name is rejected before installing", () => fixture((root, git) => {
  git("mv", "apps/example/package.json", "apps/example/renamed.json");
  let called = false;
  assert.throws(() => prepareDependencies(root, () => { called = true; }), /Dependency files differ from HEAD/);
  assert.equal(called, false);
}));
