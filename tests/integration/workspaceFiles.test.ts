import { afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, unlink, writeFile } from "@toonflow/file";
import { isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";

// 入口必须在独立子进程中设置临时数据目录，避免导入服务配置时访问用户数据。
let files: typeof import("@/utils/workspace/files");
let root: string;
beforeAll(async () => {
  const data = process.env.TOONFLOW_DATA_DIR;
  if (!data || !isAbsolute(data) || process.env.TOONFLOW_TEST_SANDBOX !== "1") throw new Error("workspace tests require an isolated data directory from the verification runner");
  files = await import("@/utils/workspace/files");
});
beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), "toonflowWorkspaceTest"))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("workspace saves and reopens exact persisted content", async () => {
  const target = await files.resolveWorkspacePath(root, "canvas.json");
  await files.writeWorkspaceFile(target.path, '{"text":"saved"}', true);
  expect(await readFile(target.path, "utf8")).toBe('{"text":"saved"}');
  await files.writeWorkspaceFile(target.path, '{"text":"edited"}');
  const reopened = await files.resolveWorkspacePath(root, "canvas.json");
  expect(await readFile(reopened.path, "utf8")).toBe('{"text":"edited"}');
});

test("workspace rejects parent traversal and absolute paths", async () => {
  await expect(files.resolveWorkspacePath(root, "../outside.txt")).rejects.toThrow("文件路径无效");
  await expect(files.resolveWorkspacePath(root, "nested/../../outside.txt")).rejects.toThrow("文件路径无效");
  await expect(files.resolveWorkspacePath(root, join(root, "absolute.txt"))).rejects.toThrow("文件路径无效");
});

test("workspace rejects mutation of its root", () => {
  expect(() => files.protectWorkspaceRoot(root, root)).toThrow("不能修改工作区根目录");
});

test("workspace exclusive save preserves same-name destination", async () => {
  const target = join(root, "canvas.json");
  await writeFile(target, "existing");
  await expect(files.writeWorkspaceFile(target, "replacement", true)).rejects.toThrow();
  expect(await readFile(target, "utf8")).toBe("existing");
});

test("workspace copy refuses existing target and preserves source", async () => {
  const source = join(root, "source.txt");
  const target = join(root, "target.txt");
  await writeFile(source, "source bytes");
  await writeFile(target, "target bytes");
  await expect(files.copyWorkspaceFile(source, target)).rejects.toThrow();
  expect(await readFile(source, "utf8")).toBe("source bytes");
  expect(await readFile(target, "utf8")).toBe("target bytes");
});

test("workspace parent lock rejects conflicting descendant then releases", async () => {
  const folder = join(root, "folder");
  await mkdir(folder);
  const release = files.lockWorkspaceFiles([folder]);
  try { expect(() => files.lockWorkspaceFiles([join(folder, "file.txt")])).toThrow("文件正在使用"); }
  finally { release(); }
  const releaseNext = files.lockWorkspaceFiles([join(folder, "file.txt")]);
  releaseNext();
});


test("shared symlink creates a real fixture and workspace rejects every escape without changing the target", async () => {
  const file = await import("@toonflow/file");
  expect(typeof file.symlink).toBe("function");
  const outside = await realpath(await mkdtemp(join(tmpdir(), "toonflowOutsideTest")));
  const link = join(root, "escape");
  const canary = join(outside, "canary.txt");
  let linked = false;
  try {
    await writeFile(canary, "outside must remain unchanged");
    await file.symlink(outside, link, process.platform === "win32" ? "junction" : "dir");
    linked = true;
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await realpath(link)).toBe(outside);
    expect(await readFile(join(link, "canary.txt"), "utf8")).toBe("outside must remain unchanged");
    await expect(file.symlink(outside, link, process.platform === "win32" ? "junction" : "dir")).rejects.toMatchObject({ code: "EEXIST" });
    await expect(files.resolveWorkspacePath(root, "escape")).rejects.toMatchObject({ status: 403, message: "不能通过符号链接操作文件" });
    await expect(files.resolveWorkspacePath(root, "escape/canary.txt")).rejects.toMatchObject({ status: 403, message: "只能操作当前工作区内的文件" });
    await expect(files.resolveWorkspacePath(root, "escape/new.txt")).rejects.toMatchObject({ status: 403, message: "只能操作当前工作区内的文件" });
    await expect(files.resolveWorkspacePath(root, "escape/missing/nested/new.txt", true)).rejects.toMatchObject({ status: 403, message: "只能操作当前工作区内的文件" });
    expect(await readdir(outside)).toEqual(["canary.txt"]);
    expect(await readFile(canary, "utf8")).toBe("outside must remain unchanged");
    await unlink(link);
    linked = false;
    await expect(lstat(link)).rejects.toMatchObject({ code: "ENOENT" });
    expect((await lstat(outside)).isDirectory()).toBe(true);
    expect(await readFile(canary, "utf8")).toBe("outside must remain unchanged");
  } finally {
    try { if (linked) await unlink(link); }
    finally { await rm(outside, { recursive: true, force: true }); }
  }
});
