/// <reference lib="dom" />
import { expect, test } from "bun:test";
import { supportsCorePlatform } from "../scripts/verificationPlan";
import { existsSync, mkdir, mkdtemp, readFile, realpath, rm, writeAtomic } from "@toonflow/file";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Browser, Page } from "../packages/tools/browser/node_modules/puppeteer-core";

// Linux/Windows x64 core path, after build:server. Unsupported hosts fail, never skip.
// Existing locked browser dependency only; this test never installs/downloads a browser.
// The preload changes listener binding/outbound APIs, not application handlers. Neither
// it nor Chrome request interception is an OS firewall or desktop/native acceptance.
const root = resolve(import.meta.dir, "..");
const origin = "http://127.0.0.1:3000";
const fixture = "Browser acceptance fixture: edited text survives reopening.\n第二行：仅使用临时测试数据。";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function cleanEnvironment(home: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"]) {
    if (process.env[name]) env[name] = process.env[name]!;
  }
  return { ...env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
    XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, TEMP: home, TMP: home, TMPDIR: home,
    NODE_ENV: "production", TZ: "UTC" };
}

async function assertPortFree(port: number) {
  const listener = createServer();
  await new Promise<void>((done, reject) => {
    listener.once("error", reject);
    listener.listen(port, "127.0.0.1", () => listener.close(error => error ? reject(error) : done()));
  });
}

async function eventually(check: () => Promise<boolean>, description: string, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (!await check()) {
    if (Date.now() >= end) throw new Error(`Timed out: ${description}`);
    await Bun.sleep(100);
  }
}

async function bounded<T>(operation: Promise<T>, stage: string, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out: ${stage}`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

// These are real pointer/keyboard actions. DOM evaluation is read-only: no Vue state,
// localStorage writes, injected events or API shortcuts for onboarding/workspace/editing.
async function clickText(page: Page, selector: string, text: string) {
  await page.waitForFunction((selector, text) => [...document.querySelectorAll<HTMLElement>(selector)]
    .some(element => element.textContent?.trim() === text && element.getClientRects().length && !element.hasAttribute("disabled")), {}, selector, text);
  const handles = await page.$$(selector);
  try {
    for (const handle of handles) {
      if (await handle.evaluate((element, text) => element.textContent?.trim() === text && element.getClientRects().length > 0, text)) {
        await handle.click();
        return;
      }
    }
    throw new Error(`Visible control disappeared: ${text}`);
  } finally { await Promise.all(handles.map(handle => handle.dispose())); }
}

async function click(page: Page, selector: string) {
  await page.waitForSelector(selector, { visible: true });
  await page.waitForFunction(selector => !document.querySelector(selector)?.hasAttribute("disabled"), {}, selector);
  await page.click(selector);
}

async function replaceText(page: Page, selector: string, value: string) {
  await click(page, selector);
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.type(value);
}

test("Core browser completes first launch, creates and edits a text node, saves and reopens persisted canvas", async () => {
  expect(supportsCorePlatform(process.platform, process.arch)).toBe(true);
  const requestedEvidence = process.env.TOONFLOW_BROWSER_EVIDENCE_DIR;
  if (!requestedEvidence || !isAbsolute(requestedEvidence)) throw new Error("TOONFLOW_BROWSER_EVIDENCE_DIR must be an absolute temporary artifact directory");
  const tempRoot = await realpath(tmpdir());
  const runnerTemp = process.env.RUNNER_TEMP;
  if (!runnerTemp || !isAbsolute(runnerTemp)) throw new Error("RUNNER_TEMP must identify the CI runner temporary directory");
  const artifactRoot = await realpath(runnerTemp);
  // Resolve an existing ancestor first: Windows RUNNER~1 and runneradmin can name
  // the same directory. Validate its canonical child before creating anything.
  let ancestor = resolve(requestedEvidence);
  const suffix: string[] = [];
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error("No existing evidence directory ancestor");
    suffix.unshift(basename(ancestor));
    ancestor = parent;
  }
  const candidate = join(await realpath(ancestor), ...suffix);
  function requireTemporaryChild(path: string) {
    const offset = relative(artifactRoot, path);
    if (!offset || offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) throw new Error("Browser evidence must be a dedicated canonical temp subdirectory");
  }
  requireTemporaryChild(candidate);
  await mkdir(candidate, { recursive: true });
  const evidence = await realpath(candidate);
  requireTemporaryChild(evidence);
  const privateRoots = [tempRoot, tmpdir(), artifactRoot, runnerTemp, root, requestedEvidence, evidence];
  function sanitize(value: string) {
    for (const path of [...privateRoots].sort((a, b) => b.length - a.length)) {
      for (const variant of [path, path.replaceAll("\\", "/"), JSON.stringify(path).slice(1, -1)]) {
        const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        value = value.replace(new RegExp(escaped, "gi"), "[private-test-path]");
      }
    }
    return value.replace(/(?:https?|wss?):\/\/[^\s<>"']+/gi, "[redacted-url]")
      .replace(/(^|[\s("'`])@[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)?/gm, "$1[redacted-mention]");
  }
  await writeAtomic(join(evidence, "browserPath.json"), JSON.stringify({ result: "FAIL", stage: "preflight not completed", steps: [] }, null, 2));
  let executablePath: string;
  let puppeteer: typeof import("../packages/tools/browser/node_modules/puppeteer-core");
  let temporary: string;
  try {
    const installed = (process.platform === "win32" ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"] : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"]).find(existsSync);
    if (!installed) throw new Error("Preinstalled Chrome/Chromium missing; no installation or download is permitted");
    executablePath = installed;
    puppeteer = await import(Bun.resolveSync("puppeteer-core", join(root, "packages/tools/browser")));
    const owner = JSON.parse(await readFile(join(root, "packages/tools/browser/package.json"), "utf8"));
    expect(owner.dependencies["puppeteer-core"]).toBe("25.12.0");
    temporary = await realpath(await mkdtemp(join(tempRoot, "toonflowBrowser")));
    privateRoots.push(temporary);
  } catch (error) {
    await writeAtomic(join(evidence, "browserPath.json"), JSON.stringify({ result: "FAIL", stage: "preflight", steps: [], failure: sanitize(String(error)), rawErrorSha256: hash(Buffer.from(String(error))) }, null, 2));
    throw new Error(sanitize(String(error)));
  }
  const home = join(temporary, "home");
  const data = join(temporary, "data");
  const workspaceName = "browserAcceptance";
  const workspace = join(data, "workspaces", workspaceName);
  const canvasPath = join(workspace, "画布1.json");
  let browser: Browser | undefined;
  let page: Page | undefined;
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let chrome: ReturnType<typeof Bun.spawn> | undefined;
  let chromeOutput = "";
  let chromeReaders: Promise<void>[] = [];
  let output = "";
  let readers: Promise<void>[] = [];
  const consoleLog: string[] = [];
  const outputErrors: string[] = [];
  const pageErrors: string[] = [];
  const networkErrors: string[] = [];
  const interceptionPending = new Set<Promise<void>>();
  const steps: { name: string; screenshot: string; url: string; time: string }[] = [];
  let failure: unknown;
  let stage = "server startup";
  async function checkpoint(next: string) {
    stage = next;
    await writeAtomic(join(evidence, "browserPath.json"), JSON.stringify({
      result: "FAIL", stage, status: "not completed", steps: steps.map(step => ({ ...step, url: sanitize(step.url) })),
      rawLogSha256: { server: hash(Buffer.from(output)), chrome: hash(Buffer.from(chromeOutput)) },
    }, null, 2));
    await writeAtomic(join(evidence, "browserServer.log"), sanitize(output));
    await writeAtomic(join(evidence, "chromeStartup.log"), sanitize(chromeOutput));
    console.log(`Browser acceptance stage: ${next}`);
  }
  const terminate = () => { if (chrome?.exitCode === null) chrome.kill("SIGKILL"); if (child?.exitCode === null) child.kill("SIGKILL"); };
  function observeOutput(operation: Promise<void>) {
    return operation.catch(error => { outputErrors.push(String(error)); terminate(); });
  }
  // Reserve the final minute of the 180s test budget for diagnostics and cleanup.
  const watchdog = setTimeout(terminate, 120_000);
  process.once("SIGINT", terminate);
  process.once("SIGTERM", terminate);
  async function capture(name: string) {
    if (!page) return;
    const screenshot = `${String(steps.length + 1).padStart(2, "0")}-${name}.png`;
    await writeAtomic(join(evidence, screenshot), await bounded(page.screenshot({ fullPage: true }), "screenshot", 7_000));
    steps.push({ name, screenshot, url: page.url(), time: new Date().toISOString() });
    await checkpoint(name);
  }
  async function exitProject() {
    await click(page!, 'button[aria-label="退出项目"]');
    await clickText(page!, ".el-dialog button", "退出项目");
    await page!.waitForSelector(".home", { visible: true });
  }
  async function closeConversation() {
    const close = await page!.$('button[aria-label="关闭对话"]');
    if (close) { try { await close.click(); } finally { await close.dispose(); } }
  }
  async function editText(value: string) {
    await closeConversation();
    await click(page!, ".vue-flow__node .editButton");
    if (!await page!.$eval(".nodeMarkdownEditor", element => !!element.querySelector("textarea")).catch(() => false))
      await clickText(page!, ".nodeMarkdownEditor .editorToolbar button", "原文");
    await replaceText(page!, 'textarea[aria-label="编辑文本内容"]', value);
    expect(await page!.$eval('textarea[aria-label="编辑文本内容"]', element => (element as HTMLTextAreaElement).value)).toBe(value);
    await capture("text-edited");
    await page!.keyboard.press("Escape");
    await page!.waitForSelector('textarea[aria-label="编辑文本内容"]', { hidden: true });
  }
  try {
    await checkpoint("server startup");
    await mkdir(home);
    await mkdir(data);
    // Sole safety preseed. Onboarding completion, workspace and canvas all come from UI.
    await writeAtomic(join(data, "settings.json"), JSON.stringify({ settings: { privacy: { dataCollectionEnabled: false } } }));
    const bundle = await readFile(join(root, "build/server/index.js"));
    await assertPortFree(3000);
    child = Bun.spawn([process.execPath, "--no-env-file", "--preload", join(root, "scripts/runtimeGuard.ts"), join(root, "build/server/index.js")], {
      cwd: root, env: { ...cleanEnvironment(home), TOONFLOW_DATA_DIR: data }, stdout: "pipe", stderr: "pipe",
    });
    async function drain(stream: ReadableStream<Uint8Array>) {
      for await (const chunk of stream) {
        output += Buffer.from(chunk).toString();
        if (output.length > 2_000_000) { terminate(); throw new Error("Excessive server output"); }
      }
    }
    readers = [observeOutput(drain(child.stdout as ReadableStream<Uint8Array>)), observeOutput(drain(child.stderr as ReadableStream<Uint8Array>))];
    await eventually(async () => {
      if (child!.exitCode !== null) throw new Error(`Server exited before readiness: ${child!.exitCode}`);
      return output.includes("[服务启动成功]");
    }, "built server startup", 30_000);
    const addresses = output.split("\n").filter(line => line.startsWith("RUNTIME_GUARD "))
      .map(line => JSON.parse(line.slice("RUNTIME_GUARD ".length))).filter(event => event.event === "listenerAddress");
    expect(addresses.length).toBeGreaterThanOrEqual(2);
    expect(addresses.every(event => event.detail.address === "127.0.0.1")).toBe(true);
    const chromeEnvironment = cleanEnvironment(home);
    if (process.platform === "win32") {
    await checkpoint("Windows known folder probe");
    const powershell = join(chromeEnvironment.SystemRoot!, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    async function probeLocalAppData(env: Record<string, string>) {
      // Same API and flags as Chromium base_paths_win.cc. Read-only, no registry
      // changes, policy overrides, real user profile access or downloads.
      const script = `$ErrorActionPreference = 'Stop'
[Console]::Error.WriteLine('PROBE process entered')
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ToonflowKnownFolderProbe {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
  public static extern int SHGetFolderPathW(IntPtr owner, int folder, IntPtr token, uint flags, StringBuilder path);
}
'@
[Console]::Error.WriteLine('PROBE type loaded')
$path = New-Object System.Text.StringBuilder 32768
[Console]::Error.WriteLine('PROBE native call entering')
$result = [ToonflowKnownFolderProbe]::SHGetFolderPathW([IntPtr]::Zero, 0x1c, [IntPtr]::Zero, 0, $path)
[Console]::Error.WriteLine('PROBE native call returned')
@{ hresult = $result; path = $path.ToString() } | ConvertTo-Json -Compress
[Console]::Error.WriteLine('PROBE output written')`;
      const probe = Bun.spawn([powershell, "-NoProfile", "-NonInteractive", "-Command", script], {
        cwd: temporary, env, stdin: "ignore", stdout: "pipe", stderr: "pipe",
      });
      let stdout = "", stderr = "";
      let exited = false, stdoutEnded = false, stderrEnded = false;
      const readProbe = async (stream: ReadableStream<Uint8Array>, channel: "stdout" | "stderr") => {
        for await (const chunk of stream) {
          if (channel === "stdout") stdout += Buffer.from(chunk).toString();
          else stderr += Buffer.from(chunk).toString();
          if (stdout.length + stderr.length > 65536) { probe.kill("SIGKILL"); throw new Error("Excessive probe output"); }
        }
        if (channel === "stdout") stdoutEnded = true; else stderrEnded = true;
      };
      const output = [readProbe(probe.stdout, "stdout"), readProbe(probe.stderr, "stderr")];
      try {
        const [code] = await bounded(Promise.all([
          probe.exited.then(code => { exited = true; return code; }), ...output,
        ]), "Windows known folder probe", 10_000);
        if (code !== 0) throw new Error(`KnownFolder probe exit=${code}; stderr SHA-256=${hash(Buffer.from(stderr))}`);
        const result = JSON.parse(stdout.replace(/^\uFEFF/, "")) as { hresult: number; path: string };
        if (!Number.isInteger(result.hresult) || typeof result.path !== "string") throw new Error("Invalid KnownFolder probe result");
        return result;
      } finally {
        try {
        await writeAtomic(join(evidence, "knownFolderProbeProgress.json"), JSON.stringify({
          exited, stdoutEnded, stderrEnded, exitCode: probe.exitCode,
          stages: stderr.split(/\r?\n/).filter(line => /^PROBE /.test(line)),
          stdoutSha256: hash(Buffer.from(stdout)), stderrSha256: hash(Buffer.from(stderr)),
        }, null, 2));
        } finally {
          if (probe.exitCode === null) probe.kill("SIGKILL");
          await bounded(Promise.all([probe.exited, ...output]), "Windows known folder probe cleanup", 3_000);
        }
      }
    }
    const beforeKnownFolder = await probeLocalAppData(chromeEnvironment);
    const localAppData = join(home, "AppData", "Local");
    const roamingAppData = join(home, "AppData", "Roaming");
    await mkdir(localAppData, { recursive: true });
    await mkdir(roamingAppData, { recursive: true });
    chromeEnvironment.LOCALAPPDATA = localAppData;
    chromeEnvironment.APPDATA = roamingAppData;
    const afterKnownFolder = await probeLocalAppData(chromeEnvironment);
    function withinIsolatedHome(path: string) {
      if (!isAbsolute(path)) return false;
      const offset = relative(home, path);
      return !!offset && offset !== ".." && !offset.startsWith(`..${sep}`) && !isAbsolute(offset);
    }
    await writeAtomic(join(evidence, "chromeKnownFolder.json"), JSON.stringify({
      before: { hresult: beforeKnownFolder.hresult, withinIsolatedHome: withinIsolatedHome(beforeKnownFolder.path) },
      after: { hresult: afterKnownFolder.hresult, withinIsolatedHome: withinIsolatedHome(afterKnownFolder.path) },
    }, null, 2));
    expect(afterKnownFolder.hresult).toBe(0);
    // Reject a native-profile result before resolving or reading that path.
    expect(withinIsolatedHome(afterKnownFolder.path)).toBe(true);
    expect(await realpath(afterKnownFolder.path)).toBe(await realpath(localAppData));
    }
    await checkpoint("Chrome arguments");
    // Windows Bun cannot be assumed to implement Chrome's extra fd 3/4 pipe
    // transport. Own the process immediately and connect over an explicit loopback
    // random port instead. No public listener, tunnel, sandbox bypass or download.
    await mkdir(join(temporary, "chrome"));
    const chromeProfile = await realpath(join(temporary, "chrome"));
    const chromeArgs = await bounded(puppeteer.default.defaultArgs({ headless: true,
      userDataDir: chromeProfile, args: ["--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "--no-default-browser-check"],
    }), "Chrome arguments", 5_000);
    const profileArguments = chromeArgs.filter(argument => argument.startsWith("--user-data-dir"));
    await writeAtomic(join(evidence, "chromeLaunch.json"), JSON.stringify({
      arguments: chromeArgs.map(sanitize), profileArgumentCount: profileArguments.length,
      profileMatchesTemporaryDirectory: profileArguments.length === 1 && profileArguments[0] === `--user-data-dir=${chromeProfile}`,
      backgroundNetworkingDisabled: chromeArgs.includes("--disable-background-networking"),
    }, null, 2));
    expect(profileArguments).toEqual([`--user-data-dir=${chromeProfile}`]);
    expect(chromeArgs).toContain("--disable-background-networking");
    if (chromeArgs.some(argument => /--(?:no-sandbox|disable-setuid-sandbox|disable-web-security|remote-debugging-pipe)(?:=|$)/.test(argument))) throw new Error("Unsafe Chrome argument refused");
    await checkpoint("Chrome endpoint startup");
    chrome = Bun.spawn([executablePath, ...chromeArgs], { cwd: temporary, env: chromeEnvironment, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    async function drainChrome(stream: ReadableStream<Uint8Array>) {
      for await (const chunk of stream) {
        chromeOutput += Buffer.from(chunk).toString();
        if (chromeOutput.length > 2_000_000) { terminate(); throw new Error("Excessive Chrome output"); }
      }
    }
    chromeReaders = [observeOutput(drainChrome(chrome.stdout as ReadableStream<Uint8Array>)), observeOutput(drainChrome(chrome.stderr as ReadableStream<Uint8Array>))];
    let endpoint: string | undefined;
    await eventually(async () => {
      if (chrome!.exitCode !== null) throw new Error(`Chrome exited before endpoint: ${chrome!.exitCode}`);
      endpoint = chromeOutput.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
      return !!endpoint;
    }, "Chrome loopback endpoint", 20_000);
    const endpointUrl = new URL(endpoint!);
    if (endpointUrl.protocol !== "ws:" || endpointUrl.hostname !== "127.0.0.1" || !endpointUrl.port
      || endpointUrl.username || endpointUrl.password || !endpointUrl.pathname.startsWith("/devtools/browser/")) throw new Error("Chrome debugging endpoint is not the expected loopback endpoint");
    await checkpoint("Chrome CDP connect");
    browser = await bounded(puppeteer.default.connect({ browserWSEndpoint: endpoint!, protocolTimeout: 10_000,
      defaultViewport: { width: 1440, height: 1000 },
    }), "Chrome CDP connect", 15_000);
    await checkpoint("Chrome new page");
    page = await bounded(browser.newPage(), "Chrome new page", 15_000);
    await checkpoint("browser request interception");
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(25_000);
    await page.setRequestInterception(true);
    page.on("request", request => {
      const url = new URL(request.url());
      const allowed = ["data:", "blob:", "about:"].includes(url.protocol) || url.origin === origin;
      if (!allowed) networkErrors.push(`${request.method()} ${url.origin}${url.pathname}`);
      const pending = (allowed ? request.continue() : request.abort("blockedbyclient"))
        .catch(error => { networkErrors.push(`InterceptionError: ${String(error)}`); })
        .finally(() => interceptionPending.delete(pending));
      interceptionPending.add(pending);
    });
    page.on("console", message => { consoleLog.push(`${message.type()}: ${message.text()}`); if (message.type() === "error") pageErrors.push(message.text()); });
    page.on("pageerror", error => pageErrors.push(String(error)));
    page.on("response", response => { if (response.status() >= 400) networkErrors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    await checkpoint("first page navigation");
    await page.goto(origin, { waitUntil: "networkidle0" });
    await page.waitForSelector(".hello", { visible: true });
    await capture("first-launch");
    // Language choice is itself a UI action, not another settings preseed.
    await click(page, ".languageTrigger");
    await click(page, 'button[data-language="zh-CN"]');
    await clickText(page, ".hello button", "稍后配置");
    await page.waitForSelector(".home", { visible: true });
    await capture("home-after-onboarding");
    await clickText(page, ".projectList button", "添加项目");
    await clickText(page, ".el-message-box button", "选择空文件夹");
    await clickText(page, ".workspaceBrowser button", "新建文件夹");
    await replaceText(page, ".el-message-box input", workspaceName);
    await clickText(page, ".el-message-box button", "创建");
    await click(page, `.workspaceBrowser .entryName[title="${workspaceName}"]`);
    await page.waitForFunction(name => document.querySelector(".directoryPath")?.textContent?.includes(name), {}, workspaceName);
    await capture("test-workspace-selected");
    await clickText(page, ".el-dialog button", "选择此目录");
    await click(page, 'button[aria-label="添加节点"]');
    await capture("empty-canvas-node-menu");
    await click(page, '.nodeMenu button[role="menuitem"][title="文本"]');
    await page.waitForSelector(".vue-flow__node .editButton", { visible: true });
    await capture("text-node-created");
    await editText("Initial fixture text");
    await editText(fixture);
    // Normal route leave explicitly flushes pending node and canvas autosaves.
    await exitProject();
    await capture("saved-return-home");
    const savedBytes = await readFile(canvasPath);
    const saved = JSON.parse(savedBytes.toString());
    expect(saved.toonflowCanvas).toBe(true);
    expect(saved.nodes).toHaveLength(1);
    expect(saved.edges).toEqual([]);
    const node = saved.nodes[0];
    expect(node.type).toBe("remote-textNode");
    expect(node.data.textPath).toBe(`assets/${node.id}/content.md`);
    expect(await readFile(join(workspace, node.data.textPath), "utf8")).toBe(fixture);
    await writeAtomic(join(evidence, "savedCanvas.json"), savedBytes);
    await eventually(async () => {
      const config = JSON.parse(await readFile(join(data, "settings.json"), "utf8"));
      return config.settings.helloCompleted === true
        && config.settings.stores?.["toonflow.projectList"]?.projectList?.some((project: { name: string }) => project.name === workspaceName);
    }, "onboarding and project list settings persisted");
    await page.reload({ waitUntil: "networkidle0" });
    await page.waitForSelector(".home", { visible: true });
    await capture("reloaded-home");
    await click(page, `button[aria-label="打开项目 ${workspaceName}"]`);
    await page.waitForSelector('.vue-flow__node [aria-label="文本内容"]', { visible: true });
    expect(await page.$eval('.vue-flow__node [aria-label="文本内容"]', element => element.textContent)).toContain("Browser acceptance fixture");
    await closeConversation();
    await click(page, ".vue-flow__node .editButton");
    await clickText(page, ".nodeMarkdownEditor .editorToolbar button", "原文");
    expect(await page.$eval('textarea[aria-label="编辑文本内容"]', element => (element as HTMLTextAreaElement).value)).toBe(fixture);
    await capture("reopened-text-exact");
    expect(await readFile(canvasPath)).toEqual(savedBytes);
    expect(await readFile(join(workspace, node.data.textPath), "utf8")).toBe(fixture);
    expect(hash(await readFile(join(root, "build/server/index.js")))).toBe(hash(bundle));
    expect(outputErrors).toEqual([]);
    expect(networkErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(output.includes('"event":"blockedOutbound"')).toBe(false);
    console.log(`Browser path: ${steps.length} screenshots; canvas SHA-256 ${hash(savedBytes)}; real Chromium ${await browser.version()}`);
  } catch (error) {
    failure = error;
    try { await capture("failure"); } catch { /* Original failure remains authoritative. */ }
    throw new Error(sanitize(String(error)));
  } finally {
    clearTimeout(watchdog);
    process.removeListener("SIGINT", terminate);
    process.removeListener("SIGTERM", terminate);
    const cleanupErrors: unknown[] = [];
    try {
      if (browser) {
        const force = setTimeout(() => { if (chrome?.exitCode === null) chrome.kill("SIGKILL"); }, 5_000);
        try { await Promise.race([browser.close(), Bun.sleep(8_000).then(() => { throw new Error("Browser cleanup timed out"); })]); }
        finally { clearTimeout(force); }
      }
    } catch (error) { cleanupErrors.push(error); }
    try {
      if (chrome) {
        if (chrome.exitCode === null) chrome.kill();
        const force = setTimeout(() => { if (chrome?.exitCode === null) chrome.kill("SIGKILL"); }, 2_000);
        try { await bounded(chrome.exited, "Chrome process cleanup", 6_000); }
        finally { clearTimeout(force); }
      }
      await bounded(Promise.all(chromeReaders), "Chrome output cleanup", 3_000);
    } catch (error) { cleanupErrors.push(error); }
    try {
      if (child) {
        if (child.exitCode === null) child.kill();
        const force = setTimeout(() => child?.kill("SIGKILL"), 2_000);
        try { await Promise.race([child.exited, Bun.sleep(6_000).then(() => { throw new Error("Server cleanup timed out"); })]); }
        finally { clearTimeout(force); }
      }
      await bounded(Promise.all(readers), "Server output cleanup", 3_000);
    } catch (error) { cleanupErrors.push(error); }
    try {
      await Promise.race([Promise.all([...interceptionPending]), Bun.sleep(3_000).then(() => { throw new Error("Pending request interception cleanup timed out"); })]);
    } catch (error) { cleanupErrors.push(error); }
    if (outputErrors.length || networkErrors.length || pageErrors.length || output.includes('"event":"blockedOutbound"')) cleanupErrors.push(new Error("Browser/server diagnostics contain errors after close"));
    try { await rm(temporary, { recursive: true, force: true }); } catch (error) { cleanupErrors.push(error); }
    const rawConsole = consoleLog.join("\n");
    try {
      await writeAtomic(join(evidence, "browserConsole.log"), sanitize(rawConsole));
      await writeAtomic(join(evidence, "browserServer.log"), sanitize(output));
      await writeAtomic(join(evidence, "chromeStartup.log"), sanitize(chromeOutput));
    } catch (error) { cleanupErrors.push(error); }
    // Serialize the final result only after shutdown, pending interceptions, data
    // removal and log writes. The initial FAIL manifest survives any earlier failure.
    try {
      await writeAtomic(join(evidence, "browserPath.json"), JSON.stringify({
        result: failure || cleanupErrors.length ? "FAIL" : "PASS", stage,
        steps: steps.map(step => ({ ...step, url: sanitize(step.url) })),
        outputErrors: outputErrors.map(sanitize), pageErrors: pageErrors.map(sanitize), networkErrors: networkErrors.map(sanitize),
        cleanupErrors: cleanupErrors.map(error => sanitize(String(error))), failure: failure ? sanitize(String(failure)) : null,
        rawLogSha256: { chrome: hash(Buffer.from(chromeOutput)), console: hash(Buffer.from(rawConsole)), server: hash(Buffer.from(output)), failure: failure ? hash(Buffer.from(String(failure))) : null },
      }, null, 2));
    } catch (error) { cleanupErrors.push(error); }
    if (cleanupErrors.length) throw new AggregateError((failure ? [failure, ...cleanupErrors] : cleanupErrors).map(error => new Error(sanitize(String(error)))), "Browser acceptance cleanup failed");
  }
}, 180_000);
