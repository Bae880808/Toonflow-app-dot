// 固定清单变更必须随 draft PR 由维护者审阅，不动态缩减覆盖。
export const workspaceGroups = {
  apps: ["desktop", "mobile", "server", "updateServer", "web"],
  packages: ["assets", "extScaffold", "ffmpeg", "file", "i18n", "mcp", "modelIcons", "nodeScaffold", "nodeShared", "providers", "startup", "teamScaffold", "toolScaffold"],
  "packages/ext": ["canvasNode", "image", "md", "media", "txt"],
  "packages/nodes": ["audioGenerationNode", "audioNode", "director3dNode", "imageGenerationNode", "imageNode", "textNode", "videoGenerationNode", "videoNode"],
  "packages/teams": ["storyboardTeam"],
  "packages/tools": ["askUser", "assetOperator", "browser", "canvas", "ffmpeg", "mediaGeneration", "skillOperator", "webFetch", "webSearch", "workspace"],
};
export const expectedWorkspaces = Object.entries(workspaceGroups).flatMap(([group, names]) => names.map((name) => `${group}/${name}`)).sort();
export const noTypecheck = ["packages/assets", "packages/modelIcons", "packages/providers", "packages/startup"];
export const coreWorkspaces = expectedWorkspaces.filter((path) => path !== "apps/desktop" && !noTypecheck.includes(path));

export const fixedTests = [
  { path: "tests/unit/providerFixture.test.ts", count: 8 },
  { path: "tests/integration/workspaceFiles.test.ts", count: 6 },
  { path: "tests/integration/pluginInitialization.test.ts", count: 5 },
];
export const profiles = ["core", "windows", "macArm64", "macX64", "android"];
export function parseOptions(args: string[]) {
  const options: Record<string, string> = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].slice(2);
    if (!["profile", "base", "head"].includes(key) || args[i] !== `--${key}` || key in options || !args[i + 1]) throw new Error("Unknown, duplicate or incomplete option");
    options[key] = args[i + 1];
  }
  if (!profiles.includes(options.profile)) throw new Error("An explicit supported profile is required");
  for (const key of ["base", "head"]) if (!/^[a-f0-9]{40}$/.test(options[key] ?? "")) throw new Error("Full lowercase commit SHAs are required");
  return options as { profile: string; base: string; head: string };
}
export function sameInventory(actual: string[], expected: string[]) {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}
export function validateTestReport(output: string, expected: number) {
  // Fail closed on an unknown reporter format, zero tests, TODO, skips, failures or a reduced suite.
  const passes = [...output.matchAll(/^\s*(\d+) pass\s*$/gm)];
  const failures = [...output.matchAll(/^\s*(\d+) fail\s*$/gm)];
  const totals = [...output.matchAll(/^Ran (\d+) tests? across (\d+) files?\./gm)];
  return expected > 0 && passes.length === 1 && failures.length === 1 && totals.length === 1
    && Number(passes[0][1]) === expected && Number(failures[0][1]) === 0
    && Number(totals[0][1]) === expected && Number(totals[0][2]) === 1
    && !/^\s*[1-9]\d* (skip|todo|fail)\b/m.test(output) && !/\((skip|todo|fail)\)/.test(output);
}
export function additionalChecks(paths: string[]) {
  const required = new Set<string>();
  for (const path of paths) {
    if (/^(apps\/desktop|packages\/startup|compat\/macIntel)\//.test(path)) for (const item of ["windows", "macArm64", "macX64"]) required.add(item);
    else if (/^apps\/mobile\//.test(path)) required.add("android");
    else if (/^apps\/updateServer\//.test(path)) required.add("updateServer");
    else if (/^apps\/web\//.test(path)) required.add("uiPath");
    else if (/^(packages\/(file|providers|nodeShared|nodes|tools|mcp|ffmpeg)|apps\/server)\//.test(path)) required.add("humanImpactReview");
    else if (!/^(docs\/|evidence\/|tests\/|scripts\/verificationPlan.ts$|scripts\/verify.ts$|\.github\/workflows\/verification.yml$)/.test(path)) required.add("humanImpactReview");
  }
  return [...required].sort();
}
export function conclusion(failed: boolean, blocked: string[]) {
  return { result: failed ? "fail" : blocked.length ? "notVerified" : "automatedChecksPassed", exitCode: failed ? 1 : blocked.length ? 2 : 0, autoMergeEligible: false };
}
