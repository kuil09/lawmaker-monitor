import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { XMLParser } from "fast-xml-parser";

import {
  assemblyRequestDispatcher,
  HttpResponseError,
  publicRequestUrl
} from "./request-policy.js";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  parseTagValue: false
});

export function parseXmlDocument(xml: string): unknown {
  return xmlParser.parse(xml);
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Buffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function readString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = readString(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (["y", "yes", "true", "1", "live", "on"].includes(normalized)) {
    return true;
  }

  if (["n", "no", "false", "0", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

export function pickFirst(
  record: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) {
      return value;
    }
  }

  return undefined;
}

export function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number.parseInt(readString(value) ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function readPositiveInteger(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function ensureUrl(value: string | undefined, fallback: string): string {
  if (!value) {
    return fallback;
  }

  try {
    return new URL(value).toString();
  } catch {
    return fallback;
  }
}

export async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const content = await readFile(path, "utf8");
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

export async function writeJsonFile(
  path: string,
  value: unknown
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2));
}

export function resolvePathFromRoot(root: string, value: string): string {
  return isAbsolute(value) ? value : resolve(root, value);
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const normalizedLimit = Math.max(1, Math.floor(limit));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(
        items[currentIndex] as T,
        currentIndex
      );
    }
  }

  const workers = Array.from(
    { length: Math.min(normalizedLimit, items.length) },
    () => runWorker()
  );

  await Promise.all(workers);
  return results;
}

export async function retryFetch<T>(
  task: (attempt: number) => Promise<T>,
  options: {
    retries: number;
    backoffMs: number;
    shouldRetry?: (error: unknown) => boolean;
    exponentialBackoff?: boolean;
    jitter?: boolean;
    maxBackoffMs?: number;
    onRetry?: (attempt: number, delayMs: number) => void;
  }
): Promise<T> {
  const retries = Math.max(0, Math.floor(options.retries));
  const backoffMs = Math.max(0, Math.floor(options.backoffMs));

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      if (
        attempt >= retries ||
        (options.shouldRetry && !options.shouldRetry(error))
      ) {
        throw error;
      }

      const multiplier = options.exponentialBackoff
        ? 2 ** attempt
        : attempt + 1;
      const baseDelay = backoffMs * multiplier;
      const delay = Math.min(
        baseDelay +
          (options.jitter ? Math.floor(Math.random() * backoffMs) : 0),
        options.maxBackoffMs ?? Number.MAX_SAFE_INTEGER
      );
      options.onRetry?.(attempt + 1, delay);
      if (delay > 0) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
      }
    }
  }

  throw new Error("retryFetch exhausted retries unexpectedly.");
}

export async function fetchTextWithTimeout(
  url: string,
  init: HeadersInit | RequestInit,
  timeoutMs: number
): Promise<string> {
  return fetchBodyWithTimeout(url, init, timeoutMs, (response) =>
    response.text()
  );
}

export async function fetchBufferWithTimeout(
  url: string,
  init: HeadersInit | RequestInit,
  timeoutMs: number
): Promise<Buffer> {
  return fetchBodyWithTimeout(url, init, timeoutMs, async (response) =>
    Buffer.from(await response.arrayBuffer())
  );
}

async function fetchBodyWithTimeout<T>(
  url: string,
  init: HeadersInit | RequestInit,
  timeoutMs: number,
  readBody: (response: Response) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(
    () => controller.abort(),
    Math.max(1, timeoutMs)
  );
  const requestInit =
    init &&
    ("headers" in init ||
      "body" in init ||
      "method" in init ||
      "signal" in init)
      ? (init as RequestInit)
      : ({ headers: init as HeadersInit } satisfies RequestInit);

  try {
    const dispatcher = assemblyRequestDispatcher(url);
    const response = await fetch(url, {
      ...requestInit,
      ...(dispatcher ? { dispatcher } : {}),
      signal: controller.signal
    });

    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpResponseError(response.status, url);
    }

    // Await the body before clearing the deadline; headers are not completion.
    return await readBody(response);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted"))
    ) {
      const timeoutError = new Error(
        `Request timed out for ${publicRequestUrl(url)} after ${timeoutMs}ms`
      );
      timeoutError.name = "TimeoutError";
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}
