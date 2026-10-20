import { expect, spyOn, test } from "bun:test";
import metaso from "@toonflow/providers/media/metaso";
import type { Provider } from "@toonflow/providers";

const provider: Provider = metaso;
const request = { model: "MiniMax-H3", prompt: "fixture only", mode: "text" as const, duration: 4, resolution: "768P" };
function fixtureContext(fetchFixture: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>, apiKey = "fixture-not-a-real-key", signal?: AbortSignal): ProviderContext {
  const unavailable = () => { throw new Error("unexpected fixture tool invocation"); };
  return {
    config: { apiKey }, signal,
    tool: {
      fetch: Object.assign(fetchFixture, { preconnect: unavailable }), errorMessage: () => "fixture task failed", hash: Bun.hash, image: Bun.Image,
      media: { inspectImage: async () => unavailable(), resizeImage: async () => unavailable() },
      audio: { convert: async () => unavailable() }, ffmpeg: async () => unavailable(),
    },
  };
}

test("provider fixture rejects missing key without transport invocation", async () => {
  let calls = 0;
  const context = fixtureContext(async () => { calls++; throw new Error("must not call transport"); }, "");
  await expect(provider.generateVideo!.call(context, request)).rejects.toThrow("请填写 API Key");
  expect(calls).toBe(0);
});

test("provider fixture maps supported text input to final video output", async () => {
  expect(metaso.models.find(model => model.id === request.model)?.mode).toContain("text");
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const context = fixtureContext(async (input, init) => {
    calls.push({ url: String(input), init });
    return Response.json(calls.length === 1 ? { task_id: "fixtureTask" } : { task: { status: "succeeded", content: { url: "fixture-video-result" } } });
  });
  expect(await provider.generateVideo!.call(context, request)).toEqual([{ mediaType: "video", type: "url", url: "fixture-video-result" }]);
  expect(calls).toHaveLength(2);
  expect(calls[0].url.endsWith("/v2/video_generation")).toBe(true);
  expect(calls[1].url.endsWith("/v2/query/video_generation/fixtureTask")).toBe(true);
  expect(calls[0].init?.method).toBe("POST");
  expect(JSON.parse(String(calls[0].init?.body))).toEqual({ model: request.model, duration: 4, resolution: "768P", content: [{ type: "text", text: "fixture only" }] });
});

test("provider fixture surfaces submission HTTP failure without polling", async () => {
  let calls = 0;
  const context = fixtureContext(async () => { calls++; return new Response("", { status: 503 }); });
  await expect(provider.generateVideo!.call(context, request)).rejects.toThrow("HTTP 503");
  expect(calls).toBe(1);
});

test("provider fixture rejects success status without required task identifier", async () => {
  const context = fixtureContext(async () => Response.json({}));
  await expect(provider.generateVideo!.call(context, request)).rejects.toThrow("任务 ID");
});

test("provider fixture surfaces failed task instead of reporting media success", async () => {
  let calls = 0;
  const context = fixtureContext(async () => Response.json(++calls === 1 ? { task_id: "fixtureTask" } : { task: { status: "failed" } }));
  await expect(provider.generateVideo!.call(context, request)).rejects.toThrow("fixture task failed");
  expect(calls).toBe(2);
});

test("provider fixture cancellation terminates pending polling", async () => {
  const controller = new AbortController();
  let calls = 0;
  const context = fixtureContext(async () => {
    if (++calls === 1) return Response.json({ task_id: "fixtureTask" });
    controller.abort(new Error("fixture cancelled"));
    return Response.json({ task: { status: "pending" } });
  }, "fixture-not-a-real-key", controller.signal);
  await expect(provider.generateVideo!.call(context, request)).rejects.toThrow("fixture cancelled");
  expect(calls).toBe(2);
});

test("provider fixture propagates its deadline to an outstanding submission", async () => {
  const deadline = new AbortController();
  const timeoutError = new DOMException("fixture deadline exceeded", "TimeoutError");
  const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let calls = 0;
  let transportSignal: AbortSignal | null | undefined;
  const context = fixtureContext(async (_input, init) => {
    calls++;
    transportSignal = init?.signal;
    if (!transportSignal) throw new Error("provider did not pass its deadline to transport");
    transportSignal.throwIfAborted();
    return new Promise<Response>((_resolve, reject) => {
      transportSignal!.addEventListener("abort", () => reject(transportSignal!.reason), { once: true });
      // Accelerate only the fixture deadline, after the transport is listening.
      timer = setTimeout(() => deadline.abort(timeoutError), 0);
    });
  });
  try {
    await expect(provider.generateVideo!.call(context, request)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(600_000);
    expect(transportSignal?.aborted).toBe(true);
    expect(transportSignal?.reason).toBe(timeoutError);
    expect(calls).toBe(1);
  } finally { clearTimeout(timer); timeout.mockRestore(); }
});

test("provider fixture deadline interrupts pending polling without another request", async () => {
  const deadline = new AbortController();
  const timeoutError = new DOMException("fixture deadline exceeded", "TimeoutError");
  const timeout = spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const signals: (AbortSignal | null | undefined)[] = [];
  const context = fixtureContext(async (_input, init) => {
    signals.push(init?.signal);
    // Run after the pending response has entered the provider's polling wait.
    if (signals.length === 2) timer = setTimeout(() => deadline.abort(timeoutError), 0);
    return Response.json(signals.length === 1 ? { task_id: "fixtureTask" } : { task: { status: "pending" } });
  });
  try {
    await expect(provider.generateVideo!.call(context, request)).rejects.toMatchObject({ name: "TimeoutError" });
    expect(timeout).toHaveBeenCalledTimes(1);
    expect(timeout).toHaveBeenCalledWith(600_000);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    expect(signals[1]).toBe(signals[0]);
    expect(signals[1]?.aborted).toBe(true);
    expect(signals[1]?.reason).toBe(timeoutError);
  } finally { clearTimeout(timer); timeout.mockRestore(); }
});
