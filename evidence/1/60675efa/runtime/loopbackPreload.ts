// Private runtime verification adapter. Not repository code and not production evidence.
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";

const allowed = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
function audit(event: string, detail: unknown) {
  console.log("RUNTIME_GUARD " + JSON.stringify({ event, detail }));
}
function assertLocal(host: unknown, operation: string) {
  if (typeof host !== "string" || !allowed.has(host)) {
    audit("blockedOutbound", { operation, host: String(host) });
    throw new Error(`Runtime verification forbids non-loopback ${operation}`);
  }
}
const originalListen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args: any[]) {
  // Node HTTP listeners only. Preserve numeric port and callback; force loopback.
  let port: number;
  let requestedHost: unknown;
  let callback: unknown;
  if (typeof args[0] === "number") {
    port = args[0];
    requestedHost = typeof args[1] === "string" ? args[1] : undefined;
    callback = args.find(value => typeof value === "function");
  } else if (typeof args[0] === "object" && typeof args[0]?.port === "number") {
    port = args[0].port;
    requestedHost = args[0].host;
    callback = args.find(value => typeof value === "function");
  } else {
    throw new Error("Runtime verification refuses unknown listener signature");
  }
  audit("forceLoopbackListen", { port, requestedHost: requestedHost ?? "unspecified", actualHost: "127.0.0.1" });
  this.once("listening", () => audit("listenerAddress", this.address()));
  return Reflect.apply(originalListen, this, [port, "127.0.0.1", ...(callback ? [callback] : [])]);
} as any;
const originalFetch = globalThis.fetch;
globalThis.fetch = function (input: any, init?: any) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  assertLocal(url.hostname, "fetch");
  audit("allowedOutbound", { operation: "fetch", hostname: url.hostname });
  return originalFetch(input, init);
} as any;
for (const [module, label] of [[http, "http"], [https, "https"]] as const) {
  for (const name of ["request", "get"] as const) {
    const original = module[name];
    module[name] = function (...args: any[]) {
      const first = args[0];
      const host = typeof first === "string" || first instanceof URL ? new URL(first).hostname : first?.hostname ?? first?.host ?? "localhost";
      assertLocal(host, `${label}.${name}`);
      return Reflect.apply(original, this, args);
    } as any;
  }
}
const originalSocketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args: any[]) {
  const first = args[0];
  let host: unknown;
  if (typeof first === "number") host = typeof args[1] === "string" ? args[1] : "localhost";
  else if (typeof first === "object" && !first?.path) host = first?.host ?? first?.hostname ?? "localhost";
  else throw new Error("Runtime verification refuses unknown socket connection");
  assertLocal(host, "net.Socket.connect");
  return Reflect.apply(originalSocketConnect, this, args);
} as any;
const originalTlsConnect = tls.connect;
tls.connect = function (...args: any[]) {
  const first = args[0];
  const host = typeof first === "object" ? first?.host ?? first?.hostname ?? "localhost" : typeof args[1] === "string" ? args[1] : "localhost";
  assertLocal(host, "tls.connect");
  return Reflect.apply(originalTlsConnect, this, args);
} as any;
audit("installed", { listener: "loopback only", outbound: "Node HTTP/TLS/net and global fetch guarded", limitation: "not an OS firewall" });
