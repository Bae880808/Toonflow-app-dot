import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeAtomic } from "@toonflow/file";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Run after bun run build:server. No source-handler mocks, downloads, or provider calls.
// This proves harnessed built-server HTTP behavior, not unmodified startup or UI acceptance.
const root = resolve(import.meta.dir, "..");
const guard = join(root, "scripts/runtimeGuard.ts");
const origin = "http://127.0.0.1:3000";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

function environment(home: string): Record<string, string> {
  // Allowlist only OS essentials. Do not inherit API keys, proxy settings, NODE_OPTIONS or Bun preload flags.
  const env: Record<string, string> = {};
  for (const name of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT"]) {
    if (process.env[name]) env[name] = process.env[name]!;
  }
  return { ...env, HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home,
    XDG_CONFIG_HOME: home, XDG_CACHE_HOME: home, TEMP: home, TMP: home, TMPDIR: home,
    NODE_ENV: "production", TZ: "UTC", LANG: "C.UTF-8" };
}

async function portFree(port: number) {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(error => error ? reject(error) : resolve()));
  });
}

async function stop(child: ReturnType<typeof Bun.spawn>) {
  if (child.exitCode === null) child.kill();
  const force = setTimeout(() => child.kill("SIGKILL"), 2_000);
  const deadline = setTimeout(() => child.kill("SIGKILL"), 5_000);
  try {
    await Promise.race([child.exited, Bun.sleep(6_000).then(() => { throw new Error("Child cleanup timed out"); })]);
  } finally { clearTimeout(force); clearTimeout(deadline); }
}

async function cleanup(finish: () => Promise<void>, directory: string, originalFailure?: unknown) {
  const failures: unknown[] = [];
  try { await finish(); } catch (error) { failures.push(error); }
  finally {
    try { await rm(directory, { recursive: true, force: true }); }
    catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(originalFailure === undefined ? failures : [originalFailure, ...failures], "Acceptance cleanup failed");
}

test("runtime guard forces loopback and rejects non-loopback fetch and sockets before IO", async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), "toonflowGuard")));
  const source = `
    import http from 'node:http'; import net from 'node:net'; import https from 'node:https';
    let escaped = 0;
    const server = http.createServer((req,res) => {
      if (req.url === '/redirectLocal') return res.writeHead(302, { Location: '/escaped' }).end();
      if (req.url === '/redirectExternal') return res.writeHead(302, { Location: 'https://example.invalid/escaped' }).end();
      if (req.url === '/escaped') escaped++;
      res.end('guard fixture');
    });
    server.listen(0, async () => {
      try {
        if (server.address().address !== '127.0.0.1') throw Error('unsafe bind');
        for (const action of [() => fetch('https://example.invalid'), () => https.get('https://example.invalid'), () => new net.Socket().connect(443, 'example.invalid')]) {
          let blocked = false; try { await action(); } catch(error) { blocked = String(error).includes('forbids non-loopback'); }
          if (!blocked) throw Error('outbound guard did not reject');
        }
        const response = await fetch('http://127.0.0.1:' + server.address().port);
        if (await response.text() !== 'guard fixture') throw Error('loopback broken');
        const base = 'http://127.0.0.1:' + server.address().port;
        for (const path of ['/redirectLocal', '/redirectExternal']) {
          let rejected = false;
          try { await fetch(base + path); } catch(error) { rejected = /redirect/i.test(String(error)); }
          if (!rejected) throw Error('redirect did not fail before following');
        }
        let overrideRejected = false;
        try { await fetch(base + '/redirectExternal', { redirect: 'follow' }); }
        catch(error) { overrideRejected = String(error).includes('forbids redirect following'); }
        if (!overrideRejected || escaped !== 0) throw Error('redirect policy bypass');
        server.close();
      } catch(error) { console.error(error); process.exitCode = 1; server.close(); }
    });`;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, "-e", source], { cwd: root, env: environment(home), stdout: "pipe", stderr: "pipe" });
  const output = new Response(child.stdout).text();
  const errors = new Response(child.stderr).text();
  let failure: unknown;
  try {
    const code = await Promise.race([child.exited, Bun.sleep(8_000).then(() => { throw new Error("Guard self-check timed out"); })]);
    expect({ code, stderrBytes: (await errors).length }).toEqual({ code: 0, stderrBytes: 0 });
    expect((await output).match(/"event":"blockedOutbound"/g)?.length).toBe(3);
  } catch (error) { failure = error; throw error; }
  finally { await cleanup(() => stop(child), home, failure); }
}, 20_000);

test("exact built server serves assets, initializes plugins and enforces persistent workspace HTTP boundaries", async () => {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "toonflowBuiltHttp")));
  const data = join(temporary, "data");
  const home = join(temporary, "home");
  await mkdir(home);
  const env = { ...environment(home), TOONFLOW_DATA_DIR: data };
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let output = "";
  let readers: Promise<void>[] = [];
  let allOutput = "";
  const ports = new Set<number>();
  let failure: unknown;
  const deadline = Date.now() + 90_000;
  const watchdog = setTimeout(() => child?.kill("SIGKILL"), 90_000);
  const terminate = () => { child?.kill("SIGKILL"); };
  process.once("SIGINT", terminate);
  process.once("SIGTERM", terminate);
  async function drain(stream: ReadableStream<Uint8Array>) {
    for await (const chunk of stream) {
      output += Buffer.from(chunk).toString();
      if (output.length > 2_000_000) { child?.kill("SIGKILL"); throw new Error("Unexpected excessive server logging"); }
    }
  }
  async function shutdown() {
    if (!child) return;
    await stop(child);
    await Promise.all(readers);
    allOutput += output;
    child = undefined;
    for (const port of ports) await portFree(port);
  }
  async function start() {
    await portFree(3000);
    output = "";
    child = Bun.spawn([process.execPath, "--no-env-file", "--preload", guard, join(root, "build/server/index.js")], {
      cwd: root, env, stdout: "pipe", stderr: "pipe",
    });
    readers = [drain(child.stdout as ReadableStream<Uint8Array>), drain(child.stderr as ReadableStream<Uint8Array>)];
    const readyBy = Math.min(deadline, Date.now() + 25_000);
    while (!output.includes("[服务启动成功]")) {
      if (child.exitCode !== null || Date.now() > readyBy) throw new Error(`Built server did not start; exit=${child.exitCode}; diagnosticSha256=${hash(Buffer.from(output))}`);
      await Bun.sleep(50);
    }
    const addresses = output.split("\n").filter(line => line.startsWith("RUNTIME_GUARD "))
      .map(line => JSON.parse(line.slice("RUNTIME_GUARD ".length)))
      .filter(event => event.event === "listenerAddress").map(event => event.detail);
    expect(addresses.length).toBeGreaterThanOrEqual(2);
    for (const address of addresses) { expect(address.address).toBe("127.0.0.1"); ports.add(address.port); }
    expect(addresses.some(address => address.port === 3000)).toBe(true);
    expect(output.includes('"event":"blockedOutbound"')).toBe(false);
  }
  async function request(path: string, method = "GET", query: Record<string, string> = {}, body?: string | Uint8Array, headers?: Record<string, string>) {
    if (Date.now() >= deadline) throw new Error("HTTP acceptance deadline exceeded");
    const url = new URL(path, origin);
    url.search = new URLSearchParams(query).toString();
    const response = await fetch(url, {
      method, body: typeof body === "string" || body === undefined ? body : new Uint8Array(body), redirect: "error", signal: AbortSignal.timeout(Math.min(5_000, deadline - Date.now())),
      headers: headers ?? { Origin: origin, "X-Toonflow-Workspace": "1", "Content-Type": "application/octet-stream" },
    });
    return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
  }
  async function api(path: string, method = "GET", query: Record<string, string> = {}, body?: string | Uint8Array, status = 200, json = false) {
    const response = await request(path, method, query, body, json ? { Origin: origin, "X-Toonflow-Workspace": "1", "Content-Type": "application/json" } : undefined);
    expect(response.status).toBe(status);
    const result = JSON.parse(response.bytes.toString());
    expect(result.code).toBe(status);
    return result.data;
  }
  try {
    const bundle = await readFile(join(root, "build/server/index.js"));
    console.log(`Harnessed built server SHA-256: ${hash(bundle)}`);
    await start();
    const html = await request("/");
    expect(html.status).toBe(200);
    expect(html.bytes).toEqual(await readFile(join(root, "build/web/index.html")));
    for (const pattern of [/<script[^>]+src="([^"]+)"/, /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/]) {
      const path = html.bytes.toString().match(pattern)?.[1];
      expect(path).toBeDefined();
      const resource = await request(path!);
      expect(resource.status).toBe(200);
      expect(resource.bytes).toEqual(await readFile(join(root, "build/web", path!.replace(/^\//, ""))));
    }
    const counts: Record<string, number> = {};
    for (const [target, source, pattern] of [
      ["nodes", "nodes", /\.umd\.js$/], ["tools", "tools", /\.tool\.js$/],
      ["ext", "ext", /^ext-.*\.umd\.js$/], ["providers", "providers/media", /\.ts$/],
    ] as const) {
      const files = (await readdir(join(root, "build", source))).filter(name => pattern.test(name));
      expect(files.length).toBeGreaterThan(0);
      counts[target] = files.length;
      for (const name of files) expect(await readFile(join(data, target, name))).toEqual(await readFile(join(root, "build", source, name)));
    }
    const skills = (await readdir(join(root, "build/skills"), { withFileTypes: true })).filter(entry => entry.isDirectory());
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) expect(await readFile(join(data, "skills", skill.name, "SKILL.md"))).toEqual(await readFile(join(root, "build/skills", skill.name, "SKILL.md")));
    const markers: Record<string, string> = {};
    for (const group of ["nodes", "tools", "providers", "skills"]) markers[group] = await readFile(join(data, group, "initialized"), "utf8");
    for (const [group, path] of [["nodes", "/api/nodes/get"], ["tools", "/api/tools/get"], ["ext", "/api/ext/list"]]) {
      const result = await api(path);
      const list = group === "tools" ? result.tools : result;
      expect(list.length).toBe(counts[group]);
      expect(list.every((item: { loadError?: unknown }) => !item.loadError)).toBe(true);
    }
    const listing = await api("/api/workspaces/list");
    const workspaceRoot = join(data, "workspaces");
    expect(resolve(listing.absolutePath)).toBe(resolve(workspaceRoot));
    await api("/api/workspaces/files/mkdir", "POST", {}, JSON.stringify({ directory: workspaceRoot, path: "acceptance" }), 200, true);
    const workspace = join(workspaceRoot, "acceptance");
    await api("/api/workspaces/check", "GET", { directory: workspace });
    const query = { directory: workspace, path: "验收文档.txt" };
    const fixture = Buffer.from("Persistence fixture\n中文保存 🌱\n");
    await api("/api/workspaces/files/write", "PUT", { ...query, exclusive: "true" }, fixture);
    expect(await readFile(join(workspace, query.path))).toEqual(fixture);
    const raw = await request("/api/workspaces/files/read", "GET", query);
    expect(raw.status).toBe(200);
    expect(raw.bytes).toEqual(fixture);
    const snapshot = await api("/api/workspaces/files/read", "GET", { ...query, snapshot: "true" });
    expect(snapshot.text).toBe(fixture.toString());
    expect(snapshot.revision).toBe(hash(fixture));
    const conflicts: Record<string, string>[] = [{ exclusive: "true" }, { expectedRevision: "0".repeat(64) }];
    for (const conflict of conflicts) {
      await api("/api/workspaces/files/write", "PUT", { ...query, ...conflict }, "unwanted replacement", 409);
      expect(await readFile(join(workspace, query.path))).toEqual(fixture);
    }
    const updated = Buffer.concat([fixture, Buffer.from("Revision update retained.\n")]);
    const saved = await api("/api/workspaces/files/write", "PUT", { ...query, expectedRevision: hash(fixture) }, updated);
    expect(saved.revision).toBe(hash(updated));
    const outside = join(temporary, "outside");
    await mkdir(outside);
    await writeAtomic(join(outside, "canary.txt"), "untouched");
    // Windows junction creation needs no Developer Mode; directory-link traversal is still exercised.
    await symlink(outside, join(workspace, "outsideLink"), process.platform === "win32" ? "junction" : "dir");
    for (const [path, status] of [["../escape.txt", 400], [join(outside, "escape.txt"), 400], ["", 400], ["outsideLink/escape.txt", 403]] as const) {
      await api("/api/workspaces/files/write", "PUT", { directory: workspace, path }, "escape", status);
    }
    await api("/api/workspaces/files/write", "PUT", { directory: outside, path: "canary.txt" }, "escape", 403);
    // Standalone server permits its own workspaces without desktop headers. Headers must never
    // authorize an outside directory here, including absent headers and an unrelated Origin.
    for (const headers of [{}, { Origin: "https://example.invalid", "X-Toonflow-Workspace": "1" }] as Record<string, string>[]) {
      const denied = await request("/api/workspaces/files/read", "GET", { directory: outside, path: "canary.txt" }, undefined, headers);
      expect(denied.status).toBe(403);
      expect(JSON.parse(denied.bytes.toString()).code).toBe(403);
    }
    await api("/api/workspaces/files/read", "GET", { path: query.path }, undefined, 400);
    await api("/api/workspaces/files/write", "PUT", { ...query, expectedRevision: "invalid" }, "invalid revision", 400);
    await api("/api/workspaces/files/write", "PUT", query, JSON.stringify({ content: "invalid body" }), 400, true);
    expect(await readFile(join(outside, "canary.txt"), "utf8")).toBe("untouched");
    expect(await readdir(outside)).toEqual(["canary.txt"]);
    expect((await readdir(workspaceRoot)).sort()).toEqual(["acceptance"]);
    expect(await readFile(join(workspace, query.path))).toEqual(updated);
    const settings = await api("/api/settings/get");
    expect((settings.customProviders ?? []).every((provider: { apiKey?: string }) => !provider.apiKey)).toBe(true);
    settings.ui = { ...settings.ui, language: "en-US" };
    await api("/api/settings/save", "PUT", {}, JSON.stringify({ settings }), 200, true);
    const canaries = ["tools", "providers", "skills"];
    for (const group of canaries) await writeAtomic(join(data, group, "userMaterial.txt"), "preserve user material\n");
    const toolPath = join(data, "tools/workspace.tool.js");
    const modified = Buffer.concat([await readFile(toolPath), Buffer.from("\n// acceptance local material\n")]);
    await writeAtomic(toolPath, modified);
    await shutdown();
    await start();
    await api("/api/workspaces/check", "GET", { directory: workspace });
    const reopened = await request("/api/workspaces/files/read", "GET", query);
    expect(reopened.status).toBe(200);
    expect(reopened.bytes).toEqual(updated);
    expect(await readFile(join(workspace, query.path))).toEqual(updated);
    const reopenedSnapshot = await api("/api/workspaces/files/read", "GET", { ...query, snapshot: "true" });
    expect(reopenedSnapshot.text).toBe(updated.toString());
    expect(reopenedSnapshot.revision).toBe(hash(updated));
    expect(await api("/api/settings/get")).toEqual(settings);
    for (const [group, marker] of Object.entries(markers)) expect(await readFile(join(data, group, "initialized"), "utf8")).toBe(marker);
    for (const group of canaries) expect(await readFile(join(data, group, "userMaterial.txt"), "utf8")).toBe("preserve user material\n");
    expect(await readFile(toolPath)).toEqual(modified);
    await shutdown();
    expect(allOutput.includes('"event":"blockedOutbound"')).toBe(false);
    expect(hash(await readFile(join(root, "build/server/index.js")))).toBe(hash(bundle));
  } catch (error) { failure = error; throw error; }
  finally {
    clearTimeout(watchdog);
    process.removeListener("SIGINT", terminate);
    process.removeListener("SIGTERM", terminate);
    await cleanup(shutdown, temporary, failure);
  }
}, 110_000);
