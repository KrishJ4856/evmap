export class MapsError extends Error {
  constructor(
    message: string,
    public status = 503,
    public retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "MapsError";
  }
}
// Error identity survives hot reloads while the shared transport stays alive.
export function isMapsError(error: unknown): error is MapsError {
  return (
    error instanceof Error &&
    error.name === "MapsError" &&
    "status" in error &&
    typeof error.status === "number"
  );
}

type Entry = {
  controller: AbortController;
  promise: Promise<unknown>;
  users: number;
};
type Cooldown = { until: number; daily: boolean };

/** Process-wide backpressure and in-flight sharing. Completed Places data is never cached. */
export function createGoogleClient({ concurrency = 2, spacingMs = 150 } = {}) {
  const inFlight = new Map<string, Entry>();
  const cooldowns = new Map<string, Cooldown>();
  const queue: (() => void)[] = [];
  let active = 0,
    lastStart = 0;

  async function acquire(signal: AbortSignal) {
    signal.throwIfAborted();
    if (active >= concurrency) {
      if (queue.length >= 40)
        throw new MapsError("Search is busy. Please try shortly.", 429, 5);
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          const index = queue.indexOf(start);
          if (index >= 0) queue.splice(index, 1);
          reject(signal.reason);
        };
        const start = () => {
          signal.removeEventListener("abort", abort);
          active++;
          resolve();
        };
        queue.push(start);
        signal.addEventListener("abort", abort, { once: true });
      });
    } else active++;
    return () => {
      active--;
      queue.shift()?.();
    };
  }

  function quotaError(cooldown: Cooldown) {
    return new MapsError(
      cooldown.daily
        ? "Maps has reached its daily limit. Please try tomorrow."
        : "Maps is temporarily busy. Please try again shortly.",
      429,
      Math.max(1, Math.ceil((cooldown.until - Date.now()) / 1000)),
    );
  }

  async function perform<T>(
    url: string,
    fields: string,
    body: unknown,
    key: string,
    scope: string,
    signal: AbortSignal,
  ): Promise<T> {
    const release = await acquire(signal);
    try {
      while (spacingMs && Date.now() - lastStart < spacingMs) {
        await new Promise((resolve) =>
          setTimeout(resolve, spacingMs - (Date.now() - lastStart)),
        );
        signal.throwIfAborted();
      }
      const cooldown = cooldowns.get(scope);
      if (cooldown && cooldown.until > Date.now()) throw quotaError(cooldown);
      cooldowns.delete(scope);
      signal.throwIfAborted();
      lastStart = Date.now();
      let response: Response;
      try {
        response = await fetch(url, {
          method: body === undefined ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            ...(fields ? { "X-Goog-FieldMask": fields } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          cache: "no-store",
          signal,
        });
      } catch {
        signal.throwIfAborted();
        throw new MapsError("Maps could not be reached. Please try again.");
      }
      if (
        response.status === 429 ||
        (response.status === 403 && scope.endsWith("/photos/:photo/media"))
      ) {
        // Read only quota metadata; never expose upstream messages or credentials.
        const data = await response.json().catch(() => ({}));
        const details =
          JSON.stringify(data?.error?.details ?? []) +
          String(data?.error?.message ?? "");
        const daily = /per.?day|daily/i.test(details);
        const header = response.headers.get("Retry-After");
        const parsed = header
          ? Number(header) || (Date.parse(header) - Date.now()) / 1000
          : 0;
        const seconds = Math.max(
          daily ? 3600 : 60,
          Number.isFinite(parsed) ? parsed : 0,
        );
        const quota = { until: Date.now() + seconds * 1000, daily };
        cooldowns.set(scope, quota);
        throw quotaError(quota);
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          throw new MapsError(
            "Google Maps access was denied. Check the API key, enabled APIs, restrictions, and billing.",
          );
        if (response.status === 404)
          throw new MapsError(
            "This Google Maps place could not be found.",
            404,
          );
        throw new MapsError(
          "Maps could not complete this search. Please try again.",
        );
      }
      return (await response.json()) as T;
    } finally {
      release();
    }
  }

  return function request<T>(
    url: string,
    fields: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    signal?.throwIfAborted();
    const key = process.env.GOOGLE_MAPS_SERVER_API_KEY;
    if (!key)
      return Promise.reject(
        new MapsError(
          "Google Maps setup is required. Add the API keys in .env.local.",
        ),
      );
    const address = new URL(url);
    const scope = `${key}:${address.host}${address.pathname
      .replace(
        /\/places\/[^/]+\/photos\/[^/]+\/media$/,
        "/places/:id/photos/:photo/media",
      )
      .replace(/\/places\/[^/]+$/, "/places/:id")}`;
    const cooldown = cooldowns.get(scope);
    if (cooldown && cooldown.until > Date.now())
      return Promise.reject(quotaError(cooldown));
    const requestKey = JSON.stringify([key, url, fields, body]);
    let entry = inFlight.get(requestKey);
    if (entry?.controller.signal.aborted) entry = undefined;
    if (!entry) {
      const controller = new AbortController();
      const created: Entry = {
        controller,
        users: 0,
        promise: Promise.resolve(),
      };
      created.promise = perform<T>(
        url,
        fields,
        body,
        key,
        scope,
        AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]),
      ).finally(() => {
        if (inFlight.get(requestKey) === created) inFlight.delete(requestKey);
      });
      inFlight.set(requestKey, created);
      entry = created;
    }
    const shared = entry;
    shared.users++;
    return new Promise<T>((resolve, reject) => {
      let finished = false;
      const finish = () => {
        if (finished) return false;
        finished = true;
        signal?.removeEventListener("abort", abort);
        if (--shared.users === 0) shared.controller.abort();
        return true;
      };
      const abort = () => {
        if (finish()) reject(signal?.reason);
      };
      signal?.addEventListener("abort", abort, { once: true });
      shared.promise.then(
        (value) => {
          if (finish()) resolve(value as T);
        },
        (error) => {
          if (finish()) reject(error);
        },
      );
    });
  };
}

// A module singleton is shared by searches, autocomplete, and stop updates in this process.
const runtime = globalThis as typeof globalThis & {
  evmapGoogleRequest?: ReturnType<typeof createGoogleClient>;
};
export const googleRequest = (runtime.evmapGoogleRequest ??=
  createGoogleClient());
