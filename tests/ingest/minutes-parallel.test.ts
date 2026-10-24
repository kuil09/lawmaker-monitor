import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import {
  assignMinutesDocument,
  isExactMinutesSelection,
  mergeMinutesWorkerArtifact,
  reconcileMinutesArtifact,
  type MinutesWorkerPlan,
  type MinutesWorkerResult
} from "../../packages/ingest/src/minutes-parallel.js";
import { parseAssemblyMinutesViewerHtml } from "../../packages/ingest/src/minutes-transcript.js";
import { sha256 } from "../../packages/ingest/src/utils.js";

const run = promisify(execFile);
const quote =
  "국민을 위한 정책을 충분히 검토하고 지원 기준을 구체적으로 마련해야 합니다.";

it("balances disjoint documents, keeps heavy documents together, and bounds every worker", () => {
  const workers: MinutesWorkerPlan["workers"] = Array.from(
    { length: 8 },
    (_, id) => ({ id, documents: [], plannedGroups: 0 })
  );
  for (let index = 0; index < 160; index++)
    assignMinutesDocument(
      workers,
      { documentId: `${index}`, sourceHash: "hash" },
      index === 0 ? 4741 : 10
    );
  expect(
    workers.every(
      (worker) => worker.documents.length <= 20 && worker.plannedGroups <= 160
    )
  ).toBe(true);
  const ids = workers.flatMap((worker) =>
    worker.documents.map((doc) => doc.documentId)
  );
  expect(new Set(ids).size).toBe(ids.length);
  expect(workers[0]!.documents).toHaveLength(1);
  expect(
    assignMinutesDocument(
      workers,
      { documentId: "overflow", sourceHash: "hash" },
      1
    )
  ).toBe(false);
  expect(isExactMinutesSelection(quote, quote.replace(/\.$/, ""))).toBe(true);
  expect(isExactMinutesSelection(quote.replace("국민", "의원"), quote)).toBe(
    false
  );
  const legacy = "가만히 좀 계세요. 질의자만 하세요, 질의자만.";
  expect(isExactMinutesSelection(legacy, legacy)).toBe(true);
  expect(
    isExactMinutesSelection(legacy.replace("질의자", "위원장"), legacy)
  ).toBe(false);
});

it("runs isolated workers, rejects fabricated selections, merges current progress idempotently, and saves surviving workers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "minutes-parallel-"));
  const read = async (path: string) =>
    JSON.parse(await readFile(join(directory, path), "utf8"));
  const write = async (path: string, value: unknown) => {
    await mkdir(dirname(join(directory, path)), { recursive: true });
    await writeFile(
      join(directory, path),
      typeof value === "string" ? value : JSON.stringify(value)
    );
  };
  const env = {
    ...process.env,
    DATA_REPO_DIR: directory,
    GITHUB_RUN_ID: "parallel-fixture",
    GITHUB_RUN_ATTEMPT: "1",
    MINUTES_SUMMARY_RUN_MODE: "backfill",
    MINUTES_SUMMARY_TARGET_DATE: "2026-10-24",
    MINUTES_SUMMARY_SOURCE_COMMIT: "a".repeat(40),
    MINUTES_SUMMARY_PLAN_PATH: join(directory, "plan.json"),
    MINUTES_SUMMARY_ENDPOINT: "http://127.0.0.1:1/unreachable"
  };
  const execute = (extra: Record<string, string> = {}, args: string[] = []) =>
    run(
      process.execPath,
      [resolve("packages/ingest/dist/scripts/summarize-minutes.js"), ...args],
      { env: { ...env, ...extra } }
    );
  try {
    for (const file of ["member_activity_calendar.json", "latest_votes.json"])
      await write(
        `exports/${file}`,
        await readFile(resolve("tests/fixtures/contracts", file), "utf8")
      );
    const items = [];
    for (const id of ["one", "two"]) {
      const transcript = parseAssemblyMinutesViewerHtml({
        documentId: id,
        sourceUrl: `https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=${id === "one" ? 1 : 2}&type=view`,
        fallbackMeetingDate: "2024-05-30",
        fallbackTitle: "위원회",
        html: `<div class="minutes_body"><a id="item1" class="tit">1. 정책 개선에 관한 안건</a><div id="spk_1" class="item1 speaker" data-name="김아라" data-pos="위원"><div class="talk"><span class="spk_sub">${quote}</span></div></div></div>`
      });
      const content = JSON.stringify(transcript);
      await write(`raw/${id}.transcript.json`, content);
      items.push({
        documentId: id,
        sourceUrl: transcript.sourceUrl,
        publishedDate: transcript.meetingDate,
        latestRelativePath: `raw/${id}.html`,
        transcriptRelativePath: `raw/${id}.transcript.json`,
        currentContentSha256: "html-sha",
        transcriptSourceContentSha256: "html-sha",
        transcriptContentSha256: sha256(content)
      });
    }
    await write("raw/index/document_index.json", {
      sourceId: "assembly-minutes",
      updatedAt: new Date().toISOString(),
      items
    });
    await execute({}, ["--plan-workers"]);
    const plan = (await read("plan.json")) as MinutesWorkerPlan;
    expect(plan.workers).toHaveLength(2);
    for (const worker of plan.workers)
      await execute({
        MINUTES_SUMMARY_WORKER_ID: `${worker.id}`,
        MINUTES_SUMMARY_WORKER_OUTPUT: join(
          directory,
          `results/worker-${worker.id}.json`
        )
      });
    await expect(
      read("exports/member_statement_summaries/index.json")
    ).rejects.toThrow();
    await rm(join(directory, "curated"), { recursive: true, force: true });
    const output = (await read("results/worker-0.json")) as MinutesWorkerResult;
    const incoming = output.artifacts[0]!;
    const source = items.find(
      (item) => item.documentId === incoming.documentId
    )!;
    const calendar = await read("exports/member_activity_calendar.json");
    const mergeArgs = {
      incoming,
      current: incoming,
      transcript: await read(source.transcriptRelativePath),
      sourceHash: source.transcriptContentSha256,
      transcriptPath: source.transcriptRelativePath,
      documentPath: source.latestRelativePath,
      members: calendar.assembly.members,
      modelId: incoming.modelId,
      generatedAt: new Date().toISOString()
    };
    expect(mergeMinutesWorkerArtifact(mergeArgs).added).toBe(0);
    expect(
      reconcileMinutesArtifact({
        ...mergeArgs,
        incoming: {
          ...incoming,
          summaries: [
            ...incoming.summaries,
            { ...incoming.summaries[0]!, statementId: "orphaned-identity" }
          ]
        }
      }).summaries
    ).toHaveLength(1);
    const changedIdentity = structuredClone(mergeArgs.transcript);
    changedIdentity.statements[0].speakerName = "朴芝源";
    changedIdentity.statements[0].officialProfileUrl =
      "https://www.assembly.go.kr/members/22nd/PARKJIWON";
    expect(
      reconcileMinutesArtifact({
        ...mergeArgs,
        transcript: changedIdentity,
        members: [
          {
            memberId: "senior-park",
            name: "박지원",
            party: "공식당",
            officialProfileUrl:
              "https://www.assembly.go.kr/members/22nd/PARKJIEWON"
          }
        ]
      }).summaries
    ).toHaveLength(0);
    expect(() =>
      mergeMinutesWorkerArtifact({
        ...mergeArgs,
        incoming: { ...incoming, sourceContentSha256: "changed" }
      })
    ).toThrow("provenance");
    expect(() =>
      mergeMinutesWorkerArtifact({
        ...mergeArgs,
        incoming: {
          ...incoming,
          summaries: [
            {
              ...incoming.summaries[0]!,
              summary: quote.replace("국민", "의원")
            }
          ]
        }
      })
    ).toThrow("Invalid source selection");
    // Simulate a newer recent-data publisher before the historical merge.
    await write(
      `curated/minutes_summaries/documents/${incoming.documentId}.json`,
      incoming
    );
    await execute({ MINUTES_SUMMARY_MERGE_DIR: join(directory, "results") });
    expect(await read("manifests/minutes_summary_state.json")).toMatchObject({
      groupsSummarized: 1,
      remainingGroups: 0,
      missingWorkers: 0,
      workersExpected: 2
    });
    expect(
      (await read("exports/member_statement_summaries/M001.json")).summaries
    ).toHaveLength(2);
    await execute({ MINUTES_SUMMARY_MERGE_DIR: join(directory, "results") });
    expect(
      (await read("exports/member_statement_summaries/M001.json")).summaries
    ).toHaveLength(2);
    expect(
      (await read("manifests/minutes_summary_state.json")).groupsSummarized
    ).toBe(0);
    const forged = structuredClone(output);
    forged.artifacts[0]!.summaries[0]!.summary = quote.replace("국민", "의원");
    await write("results/worker-0.json", forged);
    await write("merge-output.txt", "");
    await expect(
      execute({
        MINUTES_SUMMARY_MERGE_DIR: join(directory, "results"),
        GITHUB_OUTPUT: join(directory, "merge-output.txt")
      })
    ).rejects.toThrow();
    expect(
      await readFile(join(directory, "merge-output.txt"), "utf8")
    ).not.toContain("ready=true");
    await write("results/worker-0.json", output);
    // A killed worker must not prevent another worker's valid output surviving.
    await rm(join(directory, "curated"), { recursive: true });
    await rm(join(directory, "results/worker-1.json"));
    await expect(
      execute({ MINUTES_SUMMARY_MERGE_DIR: join(directory, "results") })
    ).rejects.toThrow();
    expect(await read("manifests/minutes_summary_state.json")).toMatchObject({
      groupsSummarized: 1,
      remainingGroups: 1,
      missingWorkers: 1
    });
    expect(
      (await read("exports/member_statement_summaries/M001.json")).summaries
    ).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20_000);
