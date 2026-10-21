import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, "packages/providers/package.json"), "utf8"));
const config = JSON.parse(readFileSync(resolve(root, "tests/tsconfig.json"), "utf8"));
for (const [specifier, exported] of [["@toonflow/providers", "."], ["@toonflow/providers/media/metaso", "./media/metaso"]]) {
  test(`test resolution preserves public export ${specifier}`, () => {
    const paths = config.compilerOptions.paths[specifier];
    assert.ok(Array.isArray(paths), "test import requires an explicit public-export mapping");
    assert.equal(paths.length, 1);
    assert.equal(resolve(root, "tests", paths[0]), resolve(root, "packages/providers", manifest.exports[exported]));
  });
}
