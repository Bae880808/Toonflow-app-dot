import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectSdkTypes, writeSdkTypes, sdkTypes } from "../scripts/prepareSdkTypes.ts";

function fixture(run: (root: string, archive: Buffer, specification: typeof sdkTypes) => void) {
  const root = mkdtempSync(join(tmpdir(), "sdkTypes"));
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  try {
    mkdirSync(join(root, "api/config"), { recursive: true });
    mkdirSync(join(root, "apps/desktop"), { recursive: true });
    writeFileSync(join(root, "apps/desktop/package.json"), '{"devDependencies":{"electrobun":"2.0.1"}}');
    const bytes = Buffer.from("export type Fixture = string;\n");
    writeFileSync(join(root, "api/config/Fixture.ts"), bytes);
    writeFileSync(join(root, "doNotExtract.exe"), "not executable fixture");
    const archive = execFileSync("tar", ["-czf", "-", "api/config/Fixture.ts", "doNotExtract.exe"], { cwd: root });
    run(root, archive, { version: "2.0.1", url: "unused", size: archive.length, sha256: hash(archive), files: [{ path: "api/config/Fixture.ts", size: bytes.length, sha256: hash(bytes) }] });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test("only original allowlisted bytes are written; archive programs are not extracted", () => fixture((root, archive, spec) => {
  const result = writeSdkTypes(root, archive, spec);
  assert.equal(result.files.length, 1);
  assert.equal(readFileSync(join(root, ".hutch/devkit/api/config/Fixture.ts"), "utf8"), "export type Fixture = string;\n");
  assert.equal(existsSync(join(root, ".hutch/devkit/doNotExtract.exe")), false);
}));
test("archive tampering fails before creating SDK output", () => fixture((root, archive, spec) => {
  archive[0] ^= 1;
  assert.throws(() => writeSdkTypes(root, archive, spec), /archive integrity mismatch/);
  assert.equal(existsSync(join(root, ".hutch")), false);
}));
test("archive size mismatch fails", () => fixture((root, archive, spec) => {
  assert.throws(() => selectSdkTypes(archive, { ...spec, size: archive.length + 1 }), /archive integrity mismatch/);
}));
test("member hash mismatch fails before writing", () => fixture((root, archive, spec) => {
  spec.files[0].sha256 = "0".repeat(64);
  assert.throws(() => writeSdkTypes(root, archive, spec), /member integrity mismatch/);
  assert.equal(existsSync(join(root, ".hutch")), false);
}));
test("unsafe member paths are rejected", () => fixture((root, archive, spec) => {
  spec.files[0].path = "../escape.ts";
  assert.throws(() => selectSdkTypes(archive, spec), /Unexpected SDK member path/);
}));
test("existing SDK tree is not overwritten", () => fixture((root, archive, spec) => {
  mkdirSync(join(root, ".hutch"));
  writeFileSync(join(root, ".hutch/keep"), "preserved");
  assert.throws(() => writeSdkTypes(root, archive, spec), /EEXIST/);
  assert.equal(readFileSync(join(root, ".hutch/keep"), "utf8"), "preserved");
}));
test("project version mismatch refuses SDK preparation", () => fixture((root, archive, spec) => {
  spec.version = "9.9.9";
  assert.throws(() => writeSdkTypes(root, archive, spec), /version differs/);
  assert.equal(existsSync(join(root, ".hutch")), false);
}));
