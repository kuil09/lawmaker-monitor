import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { parseAssemblyMinutesViewerHtml } from "../../packages/ingest/src/minutes-transcript.js";
import { sha256 } from "../../packages/ingest/src/utils.js";

const run = promisify(execFile);

it("preserves deferred work at a time limit, resumes without a model call, and invalidates changed transcript counts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "minutes-backfill-resume-"));
  const read = async (path: string) =>
    JSON.parse(await readFile(join(directory, path), "utf8"));
  const write = async (path: string, value: unknown) => {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(
      join(directory, path),
      typeof value === "string" ? value : JSON.stringify(value)
    );
  };
  try {
    for (const file of ["member_activity_calendar.json", "latest_votes.json"])
      await write(
        `exports/${file}`,
        await readFile(resolve("tests/fixtures/contracts", file), "utf8")
      );
    const transcript = (extra = false) =>
      parseAssemblyMinutesViewerHtml({
        documentId: "minutes-resume",
        sourceUrl:
          "https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=1&type=view",
        fallbackMeetingDate: "2024-05-30",
        fallbackTitle: "제1차 위원회",
        html: `<div class="minutes_body"><a id="item1" class="tit">1. 정책 개선에 관한 안건</a>
        <div id="spk_1" class="item1 speaker" data-name="김아라" data-pos="위원"><div class="talk"><span class="spk_sub">국민을 위한 정책을 충분히 검토하고 지원 기준을 구체적으로 마련해야 합니다.</span></div></div>
        ${extra ? '<div id="spk_2" class="item1 speaker" data-name="박민" data-pos="위원"><div class="talk"><span class="spk_sub">중소기업이 피해를 입지 않도록 지원 예산의 배분 기준을 구체적으로 정해야 합니다.</span></div></div>' : ""}</div>`
      });
    const prepare = async (extra = false) => {
      const value = transcript(extra);
      const content = JSON.stringify(value);
      await write("raw/minutes.transcript.json", content);
      await write("raw/index/document_index.json", {
        sourceId: "assembly-minutes",
        updatedAt: "2026-10-24T00:00:00Z",
        items: [
          {
            documentId: value.documentId,
            sourceUrl: value.sourceUrl,
            publishedDate: value.meetingDate,
            latestRelativePath: "raw/minutes.html",
            transcriptRelativePath: "raw/minutes.transcript.json",
            transcriptContentSha256: sha256(content)
          }
        ]
      });
    };
    const execute = async (duration: string) =>
      run(
        process.execPath,
        [resolve("packages/ingest/dist/scripts/summarize-minutes.js")],
        {
          env: {
            ...process.env,
            DATA_REPO_DIR: directory,
            MINUTES_SUMMARY_RUN_MODE: "backfill",
            MINUTES_SUMMARY_MAX_DURATION_MS: duration,
            MINUTES_SUMMARY_REQUEST_TIMEOUT_MS: "1000",
            MINUTES_SUMMARY_TARGET_DATE: "2026-10-24",
            MINUTES_SUMMARY_ENDPOINT: "http://127.0.0.1:1/unreachable"
          }
        }
      );
    await prepare();
    await execute("1");
    expect(await read("manifests/minutes_summary_state.json")).toMatchObject({
      timeLimitReached: true,
      groupsFailed: 0,
      groupsSummarized: 0,
      remainingDocuments: 1,
      remainingGroups: 1,
      readyGroups: 1,
      oldestPendingMeetingDate: "2024-05-30"
    });
    await execute("10000");
    expect(await read("manifests/minutes_summary_state.json")).toMatchObject({
      timeLimitReached: false,
      groupsFailed: 0,
      groupsSummarized: 1,
      documentsCompleted: 1,
      remainingDocuments: 0,
      remainingGroups: 0
    });
    const member = await read("exports/member_statement_summaries/M001.json");
    expect(member.summaries).toHaveLength(1);
    expect(member.summaries[0].sourceFragment).toBe("#spk_1");
    expect(member.summaries[0].summary).toBe(
      "국민을 위한 정책을 충분히 검토하고 지원 기준을 구체적으로 마련해야 합니다."
    );
    // An edited source cannot inherit either the completed artifact or the
    // cached group count from the old transcript hash.
    await prepare(true);
    await execute("1");
    expect(await read("manifests/minutes_summary_state.json")).toMatchObject({
      timeLimitReached: true,
      remainingDocuments: 1,
      remainingGroups: 2
    });
    expect(
      (await read("manifests/minutes_summary_history.json")).batches
    ).toHaveLength(3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
