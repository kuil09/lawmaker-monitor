import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import {
  loadMinutesBudget,
  saveMinutesBudget,
  MINUTES_BUDGET_REF
} from "../../scripts/minutes-budget-store.mjs";

it("migrates existing reservations without touching main and rejects a stale budget writer", async () => {
  const root = await mkdtemp(join(tmpdir(), "minutes-budget-store-"));
  const remote = join(root, "remote.git");
  const work = join(root, "work");
  const git = (args: string[], cwd = work) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
  const reservation = (id: string) => ({
    batchId: id,
    startedAt: "2026-10-24T02:00:00Z",
    minutes: 30
  });
  const legacy = { reservations: [reservation("existing")] };
  try {
    await mkdir(work);
    git(["init", "--bare", remote], root);
    git(["init", "-b", "main"]);
    await mkdir(join(work, "manifests"));
    await writeFile(
      join(work, "manifests/minutes_backfill_budget.json"),
      JSON.stringify(legacy)
    );
    git(["add", "."]);
    git([
      "-c",
      "user.name=test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "Published data"
    ]);
    git(["remote", "add", "origin", remote]);
    git(["push", "origin", "main"]);
    const main = git(["rev-parse", "HEAD"]);

    expect(loadMinutesBudget(work, legacy)).toEqual({
      budget: legacy,
      parent: null
    });
    const migrated = {
      reservations: [...legacy.reservations, reservation("next")]
    };
    saveMinutesBudget(work, migrated, null);
    const loaded = loadMinutesBudget(work, { reservations: [] });
    expect(loaded.budget).toEqual(migrated);
    expect(git(["status", "--porcelain"])).toBe("");
    expect(
      git(["ls-remote", "origin", "refs/heads/main"]).split(/\s+/)[0]
    ).toBe(main);
    expect(git(["ls-tree", "--name-only", loaded.parent])).toBe("budget.json");

    const winner = {
      reservations: [...migrated.reservations, reservation("winner")]
    };
    saveMinutesBudget(work, winner, loaded.parent);
    expect(() =>
      saveMinutesBudget(
        work,
        { reservations: [...migrated.reservations, reservation("stale")] },
        loaded.parent
      )
    ).toThrow("Minutes budget git operation failed");
    expect(loadMinutesBudget(work, null).budget).toEqual(winner);
    expect(git(["status", "--porcelain"])).toBe("");
    expect(git(["ls-remote", "origin", MINUTES_BUDGET_REF])).toContain(
      MINUTES_BUDGET_REF
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
