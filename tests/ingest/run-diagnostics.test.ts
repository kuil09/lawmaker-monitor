import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  diagnosticErrorMessage,
  runWithDiagnostics
} from "../../packages/ingest/src/run-diagnostics.js";

describe("run diagnostics", () => {
  it("redacts credentials and URL query parameters", () => {
    const message = diagnosticErrorMessage(
      new Error(
        "failed token-example https://user:pass@example.test/x?KEY=abc"
      ),
      { GH_TOKEN: "token-example" }
    );
    expect(message).toBe("failed [REDACTED] https://example.test/x");
  });
  it("preserves the underlying connection failure without leaking secrets", () => {
    const cause = Object.assign(new Error("Connect Timeout Error"), {
      code: "UND_ERR_CONNECT_TIMEOUT"
    });
    expect(
      diagnosticErrorMessage(new TypeError("fetch failed", { cause }))
    ).toBe(
      "fetch failed; caused by: [UND_ERR_CONNECT_TIMEOUT] Connect Timeout Error"
    );
  });
  it("writes a failure report without swallowing the original failure", async () => {
    const dir = await mkdtemp(join(tmpdir(), "issue48-"));
    try {
      await expect(
        runWithDiagnostics(
          "build-data",
          async () => {
            throw new Error("ambiguous member");
          },
          dir
        )
      ).rejects.toThrow("ambiguous member");
      const report = JSON.parse(
        await readFile(join(dir, "build-data.json"), "utf8")
      );
      expect(report).toMatchObject({
        stage: "build-data",
        outcome: "failure",
        error: "ambiguous member"
      });
      expect(report.startedAt).toBeTruthy();
      expect(report.finishedAt).toBeTruthy();
      expect(report).not.toHaveProperty("lastSuccessAt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("writes a success report only after task completion", async () => {
    const dir = await mkdtemp(join(tmpdir(), "issue48-"));
    try {
      await runWithDiagnostics("ingest-live", async () => {}, dir);
      expect(
        JSON.parse(await readFile(join(dir, "ingest-live.json"), "utf8"))
      ).toMatchObject({ outcome: "success", error: null });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
