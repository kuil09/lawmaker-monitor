#!/usr/bin/env bash
# Preserve provenance and the exit status even when V8 aborts before JS finally.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export BUILD_DIAGNOSTICS_DIR="${BUILD_DIAGNOSTICS_DIR:-${PWD}/artifacts/diagnostics}"
mkdir -p "${BUILD_DIAGNOSTICS_DIR}"
ulimit -c 0
node --input-type=module <<'NODE'
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { totalmem } from 'node:os';
import { join } from 'node:path';
import { getHeapStatistics } from 'node:v8';
const sha = directory => {
  try { return execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], {encoding:'utf8', stdio:['ignore','pipe','ignore']}).trim(); }
  catch { return null; }
};
writeFileSync(join(process.env.BUILD_DIAGNOSTICS_DIR, 'provenance.json'), JSON.stringify({
  codeSha: sha('.'),
  dataSha: sha(process.env.DATA_REPO_DIR || 'published-data'),
  runId: process.env.GITHUB_RUN_ID || null,
  ingestRunId: process.env.INGEST_RUN_ID || null,
  node: process.version,
  heapSizeLimit: getHeapStatistics().heap_size_limit,
  hostMemory: totalmem(),
  constrainedMemory: process.constrainedMemory()
}, null, 2));
NODE
set +e
/usr/bin/time -v -o "${BUILD_DIAGNOSTICS_DIR}/process-resources.txt" \
  npm run build:data --workspace @lawmaker-monitor/ingest
status=$?
set -e
printf '{"exitCode":%d,"finishedAt":"%s"}\n' "${status}" "$(date -u +%FT%TZ)" \
  > "${BUILD_DIAGNOSTICS_DIR}/process-exit.json"
exit "${status}"
