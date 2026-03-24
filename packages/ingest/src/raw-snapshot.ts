import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { sha256, writeJsonFile } from "./utils.js";

export type RawSnapshotEntryKind =
  | "member_info"
  | "member_profile_all"
  | "member_history"
  | "committee_overview"
  | "committee_roster"
  | "plenary_schedule"
  | "plenary_bills_law"
  | "plenary_bills_budget"
  | "plenary_bills_settlement"
  | "plenary_bills_other"
  | "vote_detail"
  | "bill_vote_summary"
  | "live"
  | "plenary_minutes";

export type RawSnapshotEntry = {
  kind: RawSnapshotEntryKind;
  endpointCode: string;
  relativePath: string;
  sourceUrl: string;
  requestParams: Record<string, string>;
  retrievedAt: string;
  checksumSha256: string;
  metadata?: Record<string, string>;
};

export type RawSnapshotManifest = {
  snapshotId: string;
  retrievedAt: string;
  entries: RawSnapshotEntry[];
};

const SNAPSHOT_MANIFEST_FILE = "snapshot-manifest.json";

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export function getSnapshotRoot(outputDir: string, snapshotId: string): string {
  return join(resolve(outputDir), "raw", snapshotId);
}

export function getSnapshotManifestPath(outputDir: string, snapshotId: string): string {
  return join(getSnapshotRoot(outputDir, snapshotId), SNAPSHOT_MANIFEST_FILE);
}

export async function writeSnapshotPayload(args: {
  outputDir: string;
  snapshotId: string;
  kind: RawSnapshotEntryKind;
  endpointCode: string;
  relativePath: string;
  sourceUrl: string;
  requestParams: Record<string, string>;
  retrievedAt: string;
  body: string;
  metadata?: Record<string, string>;
}): Promise<RawSnapshotEntry> {
  const absolutePath = join(getSnapshotRoot(args.outputDir, args.snapshotId), args.relativePath);

  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, args.body);

  return {
    kind: args.kind,
    endpointCode: args.endpointCode,
    relativePath: args.relativePath,
    sourceUrl: args.sourceUrl,
    requestParams: args.requestParams,
    retrievedAt: args.retrievedAt,
    checksumSha256: sha256(args.body),
    metadata: args.metadata
  };
}

export async function writeSnapshotManifest(args: {
  outputDir: string;
  manifest: RawSnapshotManifest;
}): Promise<void> {
  await writeJsonFile(
    getSnapshotManifestPath(args.outputDir, args.manifest.snapshotId),
    args.manifest
  );
}

export async function resolveRawSnapshot(rawRoot: string): Promise<{
  rawDir: string;
  snapshotId: string;
  manifest: RawSnapshotManifest;
}> {
  const root = resolve(rawRoot);
  const directManifestPath = join(root, SNAPSHOT_MANIFEST_FILE);

  if (await pathExists(directManifestPath)) {
    const manifest = JSON.parse(
      await readFile(directManifestPath, "utf8")
    ) as RawSnapshotManifest;

    return {
      rawDir: root,
      snapshotId: manifest.snapshotId,
      manifest
    };
  }

  const candidates: string[] = [];
  const rawNestedRoot = join(root, "raw");

  if (await pathExists(rawNestedRoot)) {
    const nested = await readdir(rawNestedRoot, { withFileTypes: true });
    candidates.push(
      ...nested.filter((entry) => entry.isDirectory()).map((entry) => join(rawNestedRoot, entry.name))
    );
  }

  const directChildren = await readdir(root, { withFileTypes: true }).catch(() => []);
  candidates.push(
    ...directChildren
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name))
  );

  for (const candidate of candidates.sort().reverse()) {
    const manifestPath = join(candidate, SNAPSHOT_MANIFEST_FILE);
    if (!(await pathExists(manifestPath))) {
      continue;
    }

    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8")
    ) as RawSnapshotManifest;

    return {
      rawDir: candidate,
      snapshotId: manifest.snapshotId || basename(candidate),
      manifest
    };
  }

  throw new Error(`Could not resolve a raw snapshot manifest under ${root}.`);
}
