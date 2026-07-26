import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const packageFiles = [
  "package.json",
  "apps/web/package.json",
  "packages/ingest/package.json",
  "packages/schemas/package.json"
];

async function readRepositoryFile(path: string) {
  return readFile(resolve(process.cwd(), path), "utf8");
}

describe("repository notice", () => {
  it("documents attribution without silently granting a project license", async () => {
    const [notice, readme] = await Promise.all([
      readRepositoryFile("NOTICE"),
      readRepositoryFile("README.md")
    ]);

    expect(notice).toContain(
      "This NOTICE file records project and third-party attribution information."
    );
    expect(notice).toContain(
      "No project-wide software license has been selected"
    );
    expect(readme).toContain("[NOTICE](./NOTICE)");
  });

  it("indexes every direct third-party runtime dependency", async () => {
    const [notice, ...packageContents] = await Promise.all([
      readRepositoryFile("NOTICE"),
      ...packageFiles.map(readRepositoryFile)
    ]);
    const dependencyNames = new Set(
      packageContents.flatMap((content) => {
        const packageJson = JSON.parse(content) as {
          dependencies?: Record<string, string>;
        };

        return Object.keys(packageJson.dependencies ?? {}).filter(
          (name) => !name.startsWith("@lawmaker-monitor/")
        );
      })
    );

    for (const dependencyName of dependencyNames) {
      expect(notice, `${dependencyName} is missing from NOTICE`).toContain(
        dependencyName
      );
    }
  });

  it("retains required upstream notices", async () => {
    const notice = await readRepositoryFile("NOTICE");

    expect(notice).toContain("Copyright 2017-2021 Uber Technologies, Inc.");
    expect(notice).toContain("Copyright (c) Microsoft Corporation.");
    expect(notice).toContain("Puppeteer project");
  });
});
