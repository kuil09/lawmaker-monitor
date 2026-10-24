import { spawnSync } from "node:child_process";

export const MINUTES_BUDGET_REF = "refs/heads/codex/minutes-backfill-budget";

function git(directory, args, input) {
  const result = spawnSync("git", args, {
    cwd: directory,
    input,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `Minutes budget git operation failed: ${result.error?.message ?? result.stderr}`
    );
  return result.stdout.trim();
}

export function loadMinutesBudget(directory, legacyBudget) {
  const probe = spawnSync(
    "git",
    ["ls-remote", "--exit-code", "--heads", "origin", MINUTES_BUDGET_REF],
    {
      cwd: directory,
      encoding: "utf8",
      timeout: 60_000
    }
  );
  if (!probe.error && probe.status === 2)
    return { budget: legacyBudget ?? { reservations: [] }, parent: null };
  if (probe.error || probe.status !== 0)
    throw new Error(
      "Cannot read remote minutes budget; refusing to reset the ceiling."
    );
  const parent = probe.stdout.split(/\s+/)[0];
  if (!/^[a-f0-9]{40}$/.test(parent))
    throw new Error("Invalid remote budget ref.");
  git(directory, ["fetch", "--no-tags", "origin", MINUTES_BUDGET_REF]);
  return {
    budget: JSON.parse(git(directory, ["show", `${parent}:budget.json`])),
    parent
  };
}

export function saveMinutesBudget(directory, budget, parent) {
  // An independent metadata tree keeps the main worktree clean and does not
  // trigger legacy Pages builds. A non-fast-forward push rejects stale writers.
  const blob = git(
    directory,
    ["hash-object", "-w", "--stdin"],
    `${JSON.stringify(budget, null, 2)}\n`
  );
  const tree = git(directory, ["mktree"], `100644 blob ${blob}\tbudget.json\n`);
  const commit = git(
    directory,
    [
      "-c",
      "user.name=github-actions",
      "-c",
      "user.email=github-actions@users.noreply.github.com",
      "commit-tree",
      tree,
      ...(parent ? ["-p", parent] : [])
    ],
    "Reserve minutes backfill budget\n"
  );
  git(directory, ["push", "origin", `${commit}:${MINUTES_BUDGET_REF}`]);
  return commit;
}
