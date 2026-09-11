import { afterEach, describe, expect, it, vi } from "vitest";
import { Agent } from "undici";

import {
  readRetryCount,
  resolveAssemblyApiConfig
} from "../../packages/ingest/src/assembly-api.js";
import {
  assemblyRequestDispatcher,
  HttpResponseError,
  isTransientRequestError,
  officialRequestRetryOptions
} from "../../packages/ingest/src/request-policy.js";
import { postAssemblyFileServiceSearch } from "../../packages/ingest/src/scripts/mirror-documents.js";
import {
  fetchTextWithTimeout,
  retryFetch
} from "../../packages/ingest/src/utils.js";
import type { APIRequestContext } from "playwright";

const config = {
  serviceInfId: "O2853M000835T714700",
  serviceInfSeq: 1,
  startUrl:
    "https://open.assembly.go.kr/portal/data/service/selectServicePage.do/O2853M000835T714700",
  timeoutMs: 45000,
  fetchRetries: 3
};
const response = (status: number, payload: unknown = { data: [] }) => ({
  ok: () => status >= 200 && status < 300,
  status: () => status,
  json: vi.fn().mockResolvedValue(payload),
  dispose: vi.fn().mockResolvedValue(undefined)
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("bounded official request recovery", () => {
  it("honors zero retries and rejects malformed retry configuration", () => {
    expect(
      resolveAssemblyApiConfig({ ASSEMBLY_FETCH_RETRIES: "0" }).fetchRetries
    ).toBe(0);
    for (const value of [undefined, "", " ", "-1", "3x", "2.5"])
      expect(readRetryCount(value, 3)).toBe(3);
  });
  it("distinguishes transient failures from authentication and data errors", () => {
    for (const status of [408, 429, 500, 502, 503, 504])
      expect(
        isTransientRequestError(new HttpResponseError(status, config.startUrl))
      ).toBe(true);
    for (const status of [400, 401, 403, 404, 422])
      expect(
        isTransientRequestError(new HttpResponseError(status, config.startUrl))
      ).toBe(false);
    expect(
      isTransientRequestError(
        new TypeError("fetch failed", {
          cause: { code: "UND_ERR_CONNECT_TIMEOUT" }
        })
      )
    ).toBe(true);
    expect(isTransientRequestError(new SyntaxError("invalid JSON"))).toBe(
      false
    );
    expect(isTransientRequestError({ name: "TimeoutError" })).toBe(true);
  });
  it("adds a reusable connect-timeout dispatcher only for the Assembly origin", () => {
    const a = assemblyRequestDispatcher(config.startUrl, {
      ASSEMBLY_CONNECT_TIMEOUT_MS: "17000"
    });
    expect(a).toBeInstanceOf(Agent);
    expect(
      assemblyRequestDispatcher(config.startUrl, {
        ASSEMBLY_CONNECT_TIMEOUT_MS: "17000"
      })
    ).toBe(a);
    expect(
      assemblyRequestDispatcher(config.startUrl, {
        ASSEMBLY_CONNECT_TIMEOUT_MS: "18000"
      })
    ).not.toBe(a);
    expect(assemblyRequestDispatcher("https://example.test")).toBeUndefined();
  });
  it("caps retries, uses exponential jitter, and omits credentials from retry logs", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const task = vi
      .fn()
      .mockRejectedValue(new HttpResponseError(503, config.startUrl));
    const promise = retryFetch(
      task,
      officialRequestRetryOptions(
        "https://open.assembly.go.kr/x?KEY=secret",
        3,
        750
      )
    );
    const assertion = expect(promise).rejects.toThrow(/HTTP 503/);
    await vi.runAllTimersAsync();
    await assertion;
    expect(task).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls.map(([line]) => JSON.parse(line).delayMs)).toEqual([
      1125, 1875, 3375
    ]);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
  });
  it("retries the file-list POST after a Playwright timeout, preserving timeout configuration", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const ok = response(200);
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    const post = vi.fn().mockRejectedValueOnce(timeout).mockResolvedValue(ok);
    const promise = postAssemblyFileServiceSearch(
      { post } as unknown as APIRequestContext,
      config
    );
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ data: [] });
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][1]).toMatchObject({
      timeout: 45000,
      failOnStatusCode: false
    });
    expect(ok.dispose).toHaveBeenCalledOnce();
  });
  it.each([429, 503])(
    "retries HTTP %i responses and disposes them",
    async (status) => {
      vi.useFakeTimers();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const bad = response(status),
        ok = response(200);
      const post = vi.fn().mockResolvedValueOnce(bad).mockResolvedValue(ok);
      const promise = postAssemblyFileServiceSearch(
        { post } as unknown as APIRequestContext,
        config
      );
      await vi.runAllTimersAsync();
      expect(await promise).toEqual({ data: [] });
      expect(bad.dispose).toHaveBeenCalledOnce();
      expect(ok.dispose).toHaveBeenCalledOnce();
    }
  );
  it.each([401, 403, 404])("fails immediately on HTTP %i", async (status) => {
    const bad = response(status);
    const post = vi.fn().mockResolvedValue(bad);
    await expect(
      postAssemblyFileServiceSearch(
        { post } as unknown as APIRequestContext,
        config
      )
    ).rejects.toThrow(`HTTP ${status}`);
    expect(post).toHaveBeenCalledOnce();
    expect(bad.dispose).toHaveBeenCalledOnce();
  });
  it.each([{}, null, { data: null }, { data: "broken" }])(
    "does not turn a malformed successful response into an empty list: %j",
    async (payload) => {
      const bad = response(200, payload);
      const post = vi.fn().mockResolvedValue(bad);
      await expect(
        postAssemblyFileServiceSearch(
          { post } as unknown as APIRequestContext,
          config
        )
      ).rejects.toThrow(/no data array/);
      expect(post).toHaveBeenCalledOnce();
      expect(bad.dispose).toHaveBeenCalledOnce();
    }
  );
  it("does not retry JSON parser failures", async () => {
    const bad = response(200);
    bad.json.mockRejectedValue(new SyntaxError("bad JSON"));
    const post = vi.fn().mockResolvedValue(bad);
    await expect(
      postAssemblyFileServiceSearch(
        { post } as unknown as APIRequestContext,
        config
      )
    ).rejects.toThrow(/bad JSON/);
    expect(post).toHaveBeenCalledOnce();
    expect(bad.dispose).toHaveBeenCalledOnce();
  });
  it("keeps the deadline active while reading a slow body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => ({
        ok: true,
        text: () =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener("abort", () =>
              reject(new DOMException("aborted", "AbortError"))
            )
          )
      }))
    );
    await expect(
      fetchTextWithTimeout("https://example.test/slow", {}, 5)
    ).rejects.toThrow(/timed out/);
  });
  it("strips key query parameters from HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("denied", { status: 403 }))
    );
    await expect(
      fetchTextWithTimeout("https://open.assembly.go.kr/x?KEY=secret", {}, 20)
    ).rejects.toThrow(
      "Failed to fetch https://open.assembly.go.kr/x: HTTP 403"
    );
    expect(vi.mocked(fetch).mock.calls[0][1]).toHaveProperty("dispatcher");
  });
});
