import { describe, expect, it, vi } from "vitest";

import {
  fetchTextWithTimeout,
  mapWithConcurrency,
  retryFetch
} from "../../packages/ingest/src/utils.js";

describe("ingest utils", () => {
  it("preserves input order while limiting concurrency", async () => {
    let activeWorkers = 0;
    let maxConcurrentWorkers = 0;

    const results = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
      activeWorkers += 1;
      maxConcurrentWorkers = Math.max(maxConcurrentWorkers, activeWorkers);

      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5 - value));

      activeWorkers -= 1;
      return value * 10;
    });

    expect(results).toEqual([10, 20, 30, 40, 50]);
    expect(maxConcurrentWorkers).toBeLessThanOrEqual(2);
  });

  it("retries failed tasks before succeeding", async () => {
    let attempts = 0;

    const result = await retryFetch(
      async () => {
        attempts += 1;

        if (attempts < 2) {
          throw new Error("Temporary failure");
        }

        return "ok";
      },
      {
        retries: 2,
        backoffMs: 1
      }
    );

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
  });

  it("times out slow fetch requests with a stable message", async () => {
    const originalFetch = global.fetch;
    const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;

      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const abortedError = new Error("aborted");
          abortedError.name = "AbortError";
          reject(abortedError);
        });
      });
    });

    global.fetch = fetchMock as typeof fetch;

    try {
      await expect(
        fetchTextWithTimeout("https://example.test/slow", {}, 5)
      ).rejects.toThrow("Request timed out for https://example.test/slow after 5ms");
    } finally {
      global.fetch = originalFetch;
    }
  });
});
