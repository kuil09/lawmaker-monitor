import { Agent } from "undici";

const assemblyOrigin = "https://open.assembly.go.kr";
const dispatchers = new Map<number, Agent>();

export function publicRequestUrl(value: string): string {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}

export class HttpResponseError extends Error {
  constructor(
    readonly status: number,
    url: string
  ) {
    super(`Failed to fetch ${publicRequestUrl(url)}: HTTP ${status}`);
    this.name = "HttpResponseError";
  }
}

export function isTransientRequestError(error: unknown): boolean {
  if (error instanceof HttpResponseError) {
    return [408, 429, 500, 502, 503, 504].includes(error.status);
  }
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const value = current as { name?: string; code?: string; cause?: unknown };
    if (
      ["AbortError", "TimeoutError"].includes(value.name ?? "") ||
      [
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_HEADERS_TIMEOUT",
        "UND_ERR_BODY_TIMEOUT",
        "UND_ERR_SOCKET",
        "ETIMEDOUT",
        "ECONNRESET",
        "ECONNREFUSED",
        "EAI_AGAIN"
      ].includes(value.code ?? "")
    ) {
      return true;
    }
    current = value.cause;
  }
  // Playwright sometimes serializes network codes into an Error message.
  return (
    error instanceof Error &&
    /\b(ECONNRESET|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN)\b/.test(error.message)
  );
}

export function officialRequestRetryOptions(
  url: string,
  retries: number,
  backoffMs: number
) {
  return {
    retries,
    backoffMs,
    exponentialBackoff: true,
    jitter: true,
    maxBackoffMs: 10_000,
    shouldRetry: isTransientRequestError,
    onRetry: (attempt: number, delayMs: number) => {
      console.warn(
        JSON.stringify({
          event: "official-request-retry",
          endpoint: publicRequestUrl(url),
          attempt,
          delayMs
        })
      );
    }
  };
}

export function assemblyRequestDispatcher(
  url: string,
  env: NodeJS.ProcessEnv = process.env
): Agent | undefined {
  if (new URL(url).origin !== assemblyOrigin) {
    return undefined;
  }
  const configured = Number(env.ASSEMBLY_CONNECT_TIMEOUT_MS);
  const timeout =
    Number.isSafeInteger(configured) && configured > 0 ? configured : 15_000;
  let dispatcher = dispatchers.get(timeout);
  if (!dispatcher) {
    dispatcher = new Agent({ connect: { timeout } });
    dispatchers.set(timeout, dispatcher);
  }
  return dispatcher;
}
