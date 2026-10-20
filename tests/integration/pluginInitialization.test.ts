import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "@toonflow/file";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initializePlugins from "@/utils/plugins/initialize";

let root: string;
let source: string;
let target: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "toonflowPluginTest"));
  source = join(root, "source");
  target = join(root, "target");
  await mkdir(source);
  await mkdir(target);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("plugins first revision installs selected built-ins and writes exact revision", async () => {
  await writeFile(join(source, "builtin.js"), "built-in v1");
  await writeFile(join(source, "ignored.txt"), "not a plugin");
  await initializePlugins(target, source, ["builtin.js"], "revision1");
  expect(await readFile(join(target, "builtin.js"), "utf8")).toBe("built-in v1");
  expect(await readFile(join(target, "initialized"), "utf8")).toBe("revision1");
  expect(existsSync(join(target, "ignored.txt"))).toBe(false);
});

test("plugins same revision restart leaves installed bytes unchanged", async () => {
  await writeFile(join(source, "builtin.js"), "built-in v1");
  await initializePlugins(target, source, ["builtin.js"], "revision1");
  await writeFile(join(source, "builtin.js"), "changed source");
  await initializePlugins(target, source, ["builtin.js"], "revision1");
  expect(await readFile(join(target, "builtin.js"), "utf8")).toBe("built-in v1");
});

test("plugins revision upgrade preserves third-party plugins and user materials", async () => {
  await writeFile(join(source, "builtin.js"), "built-in v1");
  await initializePlugins(target, source, ["builtin.js"], "revision1");
  await writeFile(join(target, "thirdParty.js"), "user plugin");
  await writeFile(join(target, "material.txt"), "user material");
  await writeFile(join(source, "builtin.js"), "built-in v2");
  await initializePlugins(target, source, ["builtin.js"], "revision2");
  expect(await readFile(join(target, "builtin.js"), "utf8")).toBe("built-in v2");
  expect(await readFile(join(target, "initialized"), "utf8")).toBe("revision2");
  expect(await readFile(join(target, "thirdParty.js"), "utf8")).toBe("user plugin");
  expect(await readFile(join(target, "material.txt"), "utf8")).toBe("user material");
});

test("plugins failed replacement preserves prior revision and recoverable target", async () => {
  await writeFile(join(source, "builtin.js"), "new bytes");
  await writeFile(join(target, "initialized"), "revision1");
  await mkdir(join(target, "builtin.js"));
  await writeFile(join(target, "builtin.js", "user.txt"), "preserve me");
  await expect(initializePlugins(target, source, ["builtin.js"], "revision2")).rejects.toThrow();
  expect(await readFile(join(target, "initialized"), "utf8")).toBe("revision1");
  expect(await readFile(join(target, "builtin.js", "user.txt"), "utf8")).toBe("preserve me");
  expect((await readdir(target)).some(name => name.startsWith(".pluginSync"))).toBe(false);
}, 15000);

test("plugins missing source does not advance revision", async () => {
  await writeFile(join(target, "initialized"), "revision1");
  await initializePlugins(target, join(root, "missing"), ["builtin.js"], "revision2");
  expect(await readFile(join(target, "initialized"), "utf8")).toBe("revision1");
});
