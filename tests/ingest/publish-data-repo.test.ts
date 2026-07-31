import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const publishScript = resolve(process.cwd(), "scripts/publish-data-repo.sh");
const temporaryRoots: string[] = [];

function runGit(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8"
  }).trim();
}

function configureAuthor(cwd: string): void {
  runGit(cwd, "config", "user.name", "Test Author");
  runGit(cwd, "config", "user.email", "test@example.com");
}

function createRepositoryFixture(): {
  root: string;
  remote: string;
  worker: string;
  racer: string;
} {
  const root = mkdtempSync(join(tmpdir(), "publish-data-repo-"));
  temporaryRoots.push(root);
  const remote = join(root, "remote.git");
  const seed = join(root, "seed");
  const worker = join(root, "worker");
  const racer = join(root, "racer");

  runGit(root, "init", "--bare", "--initial-branch=main", remote);
  runGit(root, "clone", remote, seed);
  configureAuthor(seed);
  mkdirSync(join(seed, "exports"), { recursive: true });
  mkdirSync(join(seed, "manifests"), { recursive: true });
  writeFileSync(join(seed, "exports", "state.json"), '{"value":1}\n');
  writeFileSync(join(seed, "manifests", "other.json"), '{"value":1}\n');
  runGit(seed, "add", "exports", "manifests");
  runGit(seed, "commit", "-m", "Initial data");
  runGit(seed, "push", "origin", "main");

  runGit(root, "clone", remote, worker);
  runGit(root, "clone", remote, racer);
  configureAuthor(racer);

  return { root, remote, worker, racer };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("publish-data-repo", () => {
  it("rebases a selected generated-data change over a concurrent remote update", () => {
    const { root, remote, worker, racer } = createRepositoryFixture();

    writeFileSync(join(worker, "exports", "state.json"), '{"value":2}\n');
    writeFileSync(join(racer, "manifests", "other.json"), '{"value":2}\n');
    runGit(racer, "add", "manifests");
    runGit(racer, "commit", "-m", "Concurrent data");
    runGit(racer, "push", "origin", "main");

    execFileSync(
      "bash",
      [publishScript, worker, "main", "Publish selected data", "exports"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PUBLISH_RETRY_DELAY_SECONDS: "0"
        }
      }
    );

    const verification = join(root, "verification");
    runGit(root, "clone", remote, verification);
    expect(
      readFileSync(join(verification, "exports", "state.json"), "utf8")
    ).toBe('{"value":2}\n');
    expect(
      readFileSync(join(verification, "manifests", "other.json"), "utf8")
    ).toBe('{"value":2}\n');
  });

  it("does not create a commit for changes outside the selected paths", () => {
    const { worker } = createRepositoryFixture();
    const before = runGit(worker, "rev-parse", "HEAD");
    writeFileSync(join(worker, "notes.txt"), "not generated data\n");

    execFileSync(
      "bash",
      [publishScript, worker, "main", "Publish selected data", "exports"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          PUBLISH_RETRY_DELAY_SECONDS: "0"
        }
      }
    );

    expect(runGit(worker, "rev-parse", "HEAD")).toBe(before);
    expect(runGit(worker, "status", "--short")).toContain("?? notes.txt");
  });
});
