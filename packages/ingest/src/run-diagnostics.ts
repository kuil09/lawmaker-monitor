import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { publicRequestUrl } from "./request-policy.js";

export function diagnosticErrorMessage(
  error: unknown,
  env: NodeJS.ProcessEnv = process.env
): string {
  const messages: string[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current !== undefined && !seen.has(current) && messages.length < 8) {
    seen.add(current);
    if (!(current instanceof Error)) {
      messages.push(String(current));
      break;
    }
    const code = "code" in current ? String(current.code) : undefined;
    messages.push(`${code ? `[${code}] ` : ""}${current.message}`);
    current = current.cause;
  }
  let message = messages.join("; caused by: ");
  for (const [name, value] of Object.entries(env)) {
    if (
      /(KEY|TOKEN|SECRET|PASSWORD|PAT)$/.test(name) &&
      value &&
      value.length >= 4
    ) {
      message = message.replaceAll(value, "[REDACTED]");
    }
  }
  return message.replace(/https?:\/\/[^\s)]+/g, (url) => {
    try {
      return publicRequestUrl(url);
    } catch {
      return "[REDACTED_URL]";
    }
  });
}

/** Diagnostics never update public manifests or turn a failed run into success. */
export async function runWithDiagnostics(
  stage: string,
  task: () => Promise<void>,
  directory?: string
): Promise<void> {
  const startedAt = new Date().toISOString();
  const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  const path = resolve(
    directory ??
      process.env.BUILD_DIAGNOSTICS_DIR ??
      resolve(root, "artifacts/diagnostics"),
    `${stage}.json`
  );
  const save = async (
    outcome: "running" | "success" | "failure",
    error: string | null = null
  ) => {
    const report = {
      stage,
      outcome,
      startedAt,
      finishedAt: outcome === "running" ? null : new Date().toISOString(),
      runId: process.env.GITHUB_RUN_ID ?? null,
      commitSha: process.env.GITHUB_SHA ?? null,
      error
    };
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(report, null, 2));
    } catch {
      console.warn(
        "Unable to save run diagnostics; inspect the Actions job log."
      );
    }
  };

  // Fatal V8 errors do not reach catch/finally. Persist an unfinished attempt first.
  await save("running");
  let errorMessage: string | null = null;
  try {
    await task();
  } catch (error) {
    errorMessage = diagnosticErrorMessage(error);
    throw new Error(errorMessage);
  } finally {
    await save(errorMessage === null ? "success" : "failure", errorMessage);
  }
}
