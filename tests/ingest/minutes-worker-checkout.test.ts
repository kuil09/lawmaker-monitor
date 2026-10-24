import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
// @ts-expect-error Operational Git helper is an ESM script.
import { checkoutMinutesWorker } from "../../scripts/checkout-minutes-worker.mjs";

it("materializes only assigned transcripts and rejects source drift without changing the pinned checkout", async () => {
  const root = await mkdtemp(join(tmpdir(), "minutes-sparse-"));
  const source = join(root, "source"),
    worker = join(root, "worker");
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
  const write = async (path: string, value: unknown) => {
    await mkdir(dirname(join(source, path)), { recursive: true });
    await writeFile(join(source, path), JSON.stringify(value));
  };
  try {
    await mkdir(source);
    git(source, "init");
    await write("raw/index/document_index.json", {
      items: [
        {
          documentId: "one",
          transcriptRelativePath: "raw/one.transcript.json",
          transcriptContentSha256: "hash"
        },
        {
          documentId: "two",
          transcriptRelativePath: "raw/two.transcript.json",
          transcriptContentSha256: "hash2"
        }
      ]
    });
    await write("exports/member_activity_calendar.json", { members: [] });
    await write("curated/minutes_summaries/documents/one.json", {});
    await write("raw/one.transcript.json", { selected: true });
    await write("raw/two.transcript.json", { unassigned: true });
    await write("raw/archive/large-original.html", { unrelated: true });
    git(source, "add", ".");
    git(
      source,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "Pinned inputs"
    );
    const sourceCommit = git(source, "rev-parse", "HEAD");
    git(root, "clone", "--no-checkout", source, worker);
    git(
      worker,
      "sparse-checkout",
      "set",
      "--no-cone",
      "/raw/index/document_index.json",
      "/exports/member_activity_calendar.json",
      "/curated/minutes_summaries/documents/"
    );
    git(worker, "checkout", "--detach", sourceCommit);
    const plan = {
      sourceCommit,
      workers: [
        { id: 0, documents: [{ documentId: "one", sourceHash: "hash" }] }
      ]
    };
    await checkoutMinutesWorker(worker, plan, 0);
    expect(
      JSON.parse(
        await readFile(join(worker, "raw/one.transcript.json"), "utf8")
      )
    ).toEqual({ selected: true });
    for (const path of [
      "raw/two.transcript.json",
      "raw/archive/large-original.html"
    ])
      await expect(readFile(join(worker, path))).rejects.toThrow();
    expect(git(worker, "rev-parse", "HEAD")).toBe(sourceCommit);
    await expect(
      checkoutMinutesWorker(
        worker,
        { ...plan, sourceCommit: "b".repeat(40) },
        0
      )
    ).rejects.toThrow("pinned commit");
    await expect(
      checkoutMinutesWorker(
        worker,
        {
          ...plan,
          workers: [
            { id: 0, documents: [{ documentId: "two", sourceHash: "changed" }] }
          ]
        },
        0
      )
    ).rejects.toThrow("pinned index");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
