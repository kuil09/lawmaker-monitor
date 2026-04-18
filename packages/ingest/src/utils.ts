import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import { XMLParser } from "fast-xml-parser";

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
  }
): Promise<T> {
  const retries = Math.max(0, Math.floor(options.retries));
  const backoffMs = Math.max(0, Math.floor(options.backoffMs));

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      if (attempt >= retries) {
        throw error;
      }

      const delay = backoffMs * (attempt + 1);
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
    const response = await fetch(url, {
      ...requestInit,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch ${url}: ${response.status} ${response.statusText}`
      );
    }

    return response.text();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted"))
    ) {
      throw new Error(`Request timed out for ${url} after ${timeoutMs}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}
