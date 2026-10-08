import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleClient } from "../server/google-client";

const fetchMock = vi.fn();
const url = "https://places.googleapis.com/v1/places:searchText";
const reply = (body: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(body), { status, headers });
beforeEach(() => {
  vi.stubEnv("GOOGLE_MAPS_SERVER_API_KEY", "private-test-key");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Google request backpressure", () => {
  it("backs off across photo names on the Photos API's 403 quota response", async () => {
    const client = createGoogleClient({ spacingMs: 0 });
    fetchMock.mockResolvedValueOnce(
      new Response("quota image", { status: 403 }),
    );
    await expect(
      client(
        "https://places.googleapis.com/v1/places/a/photos/first/media",
        "",
      ),
    ).rejects.toMatchObject({ status: 429, retryAfterSeconds: 60 });
    await expect(
      client(
        "https://places.googleapis.com/v1/places/b/photos/second/media",
        "",
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("shares identical in-flight work, but does not cache completed Places responses", async () => {
    const client = createGoogleClient({ spacingMs: 0 });
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const first = client(url, "places.id", { textQuery: "chargers" });
    const second = client(url, "places.id", { textQuery: "chargers" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    finish(reply({ places: [{ id: "a" }] }));
    expect(await first).toEqual(await second);
    fetchMock.mockImplementation(() => Promise.resolve(reply({ places: [] })));
    await client(url, "places.id", { textQuery: "chargers" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("limits total concurrency to two and drops queued work when its caller cancels", async () => {
    const client = createGoogleClient({ spacingMs: 0 });
    const finish: ((response: Response) => void)[] = [];
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => finish.push(resolve)),
    );
    const first = client(url, "", { query: 1 }),
      second = client(url, "", { query: 2 });
    await vi.waitFor(() => expect(finish).toHaveLength(2));
    const controller = new AbortController();
    const queued = client(url, "", { query: 3 }, controller.signal);
    const cancelled = expect(queued).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await cancelled;
    finish.forEach((resolve) => resolve(reply({ places: [] })));
    await Promise.all([first, second]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("one subscriber cancelling does not cancel another subscriber's search", async () => {
    const client = createGoogleClient({ spacingMs: 0 });
    let finish!: (response: Response) => void;
    let networkSignal!: AbortSignal;
    fetchMock.mockImplementation((_url, options) => {
      networkSignal = options.signal;
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    });
    const controller = new AbortController();
    const cancelled = client(url, "", {}, controller.signal);
    const other = client(url, "", {});
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const rejection = expect(cancelled).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejection;
    expect(networkSignal.aborted).toBe(false);
    finish(reply({ places: [{ id: "kept" }] }));
    expect(await other).toEqual({ places: [{ id: "kept" }] });
  });
  it("aborts the Google request once every subscriber has cancelled", async () => {
    const client = createGoogleClient({ spacingMs: 0 });
    let networkSignal!: AbortSignal;
    fetchMock.mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          networkSignal = options.signal;
          networkSignal.addEventListener("abort", () =>
            reject(networkSignal.reason),
          );
        }),
    );
    const controller = new AbortController();
    const pending = client(url, "", {}, controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const rejection = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejection;
    expect(networkSignal.aborted).toBe(true);
  });
  it("opens a per-service cooldown on 429, honours Retry-After, and makes no immediate retry calls", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = Date.now();
    const client = createGoogleClient({ spacingMs: 0 });
    fetchMock.mockResolvedValueOnce(
      reply({ error: { message: "private-test-key" } }, 429, {
        "Retry-After": "120",
      }),
    );
    await expect(client(url, "", {})).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 120,
    });
    await expect(client(url, "", { changed: true })).rejects.toMatchObject({
      status: 429,
      retryAfterSeconds: 120,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockImplementation(() => Promise.resolve(reply({ places: [] })));
    await client(
      "https://places.googleapis.com/v1/places:searchNearby",
      "",
      {},
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.setSystemTime(now + 121000);
    await client(url, "", {});
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("starts fresh work immediately after the last subscriber cancels an identical search", async () => {
    const client = createGoogleClient({ spacingMs: 0 });
    const controller = new AbortController();
    fetchMock.mockImplementationOnce(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () =>
            reject(options.signal.reason),
          );
        }),
    );
    const first = client(url, "", {}, controller.signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const rejection = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    fetchMock.mockResolvedValueOnce(reply({ places: [{ id: "fresh" }] }));
    const replacement = client(url, "", {});
    await rejection;
    expect(await replacement).toEqual({ places: [{ id: "fresh" }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("recognises a daily quota separately and never exposes the raw upstream error", async () => {
    const client = createGoogleClient({ spacingMs: 0 });
    fetchMock.mockResolvedValue(
      reply(
        {
          error: {
            message: "private-test-key daily quota",
            details: [{ metadata: { quota_limit: "ComputeRoutesPerDay" } }],
          },
        },
        429,
      ),
    );
    await expect(
      client(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        "",
        {},
      ),
    ).rejects.toMatchObject({
      message: "Maps has reached its daily limit. Please try tomorrow.",
      status: 429,
      retryAfterSeconds: 3600,
    });
  });
});
