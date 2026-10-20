import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const sdkTypes = {
  version: "2.0.1",
  url: "https://github.com/blackboardsh/electrobun/releases/download/v2.0.1/electrobun-core-win-x64.tar.gz",
  size: 10492653,
  sha256: "b0251163afc64c622a92c26fa37281d637ae83503e89396e581e618572494e0a",
  files: [
    { path: "api/config/ElectrobunConfig.ts", size: 19146, sha256: "264d9f2d39d9bb9afe9feaa85e967415db34b3945b688a08e50130876961380a" },
    { path: "api/config/windowsPermissions.ts", size: 762, sha256: "61af19eb4d3e27b3dd019fa9e84550def3c042ee13443ab0edf84cb48a7c9b96" },
  ],
};
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export function selectSdkTypes(archive: Buffer, specification = sdkTypes) {
  if (archive.length !== specification.size || hash(archive) !== specification.sha256) throw new Error("SDK archive integrity mismatch");
  return specification.files.map(file => {
    if (!/^api\/config\/[A-Za-z]+\.ts$/.test(file.path)) throw new Error("Unexpected SDK member path");
    // Stream only allowlisted members to memory; never extract archive paths to disk or execute its programs.
    const bytes = execFileSync("tar", ["-xOzf", "-", file.path], { input: archive, timeout: 30000, maxBuffer: file.size + 1 });
    if (bytes.length !== file.size || hash(bytes) !== file.sha256) throw new Error("SDK member integrity mismatch");
    return { ...file, bytes };
  });
}
export function writeSdkTypes(root: string, archive: Buffer, specification = sdkTypes) {
  const manifest = JSON.parse(readFileSync(resolve(root, "apps/desktop/package.json"), "utf8"));
  if (manifest.dependencies?.electrobun !== specification.version && manifest.devDependencies?.electrobun !== specification.version) throw new Error("SDK version differs from project manifest");
  const files = selectSdkTypes(archive, specification);
  // Before dependency installation, use runner primitives. Refuse an existing tree, including symlinks.
  mkdirSync(resolve(root, ".hutch"));
  const destination = resolve(root, ".hutch/devkit/api/config");
  mkdirSync(destination, { recursive: true });
  for (const file of files) writeFileSync(resolve(destination, file.path.split("/").at(-1)!), file.bytes, { flag: "wx" });
  return { version: specification.version, archiveSha256: specification.sha256, files: files.map(({ bytes, ...file }) => file) };
}
async function download() {
  const response = await fetch(sdkTypes.url, { credentials: "omit", signal: AbortSignal.timeout(60000) });
  if (!response.ok || !response.body) throw new Error("SDK archive download failed");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > sdkTypes.size) throw new Error("SDK archive exceeds pinned size");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify({ preparation: "original SDK configuration types only; no SDK programs", ...writeSdkTypes(fileURLToPath(new URL("../", import.meta.url)), await download()) }));
  } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
