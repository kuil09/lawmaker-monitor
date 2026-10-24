# Bounded minutes backlog processing

Implemented on 2026-10-24. The observed baseline was 1,928 transcripts,
62 completed documents, and 1,866 incomplete documents. A recent batch completed
19 documents and 157 groups in about 15 minutes. These are observations from one
batch, not a guaranteed rate for the historical corpus.

## Execution and budgets

- The existing mirror dispatch remains the normal recent-data path. Normal
  selection prioritizes the target date and the preceding 14 days, then rotates
  unattempted work ahead of previously attempted work. It publishes and refreshes
  derived analyses immediately.
- Historical batches run at 02:15, 05:15, 08:15, 11:15, 14:15, 17:15, 20:15,
  and 23:15 KST. They select the oldest eligible documents first and do not
  consult the recent-success recovery gate.
- Each historical batch now uses up to eight disjoint CPU workers. Each worker
  is capped at 20 documents, 160 groups, a shared 20-minute inference deadline,
  and a 30-minute job timeout. Individual model
  retries and multi-chunk groups share that deadline. Unfinished groups remain
  pending, without being recorded as failed or complete just because time ran out.
- Before model startup, the planner pushes a 265-minute aggregate reservation to
  `budget.json` on the data repository's independent
  `codex/minutes-backfill-budget` branch. The admitted output is emitted only
  after that push succeeds. At most eight reservations and
  2,120 reserved minutes (35 hours 20 minutes of aggregate runner time) are admitted per Korean calendar date. Failed, canceled,
  and forcibly terminated attempts retain their reservation. Backfill failures
  wait for the next scheduled slot; they do not recursively dispatch retries.
  Each reservation includes eight 30-minute worker timeouts, a 10-minute planner,
  and a 15-minute publisher. Unused worker capacity is not refunded. This replaces
  the initial four-hour aggregate ceiling under the user-approved 2–3 week target.
  Legacy single-worker reservations remain charged and count toward the eight
  daily batches. This budget covers historical jobs; existing recent-data ingestion,
  analysis builds, and deployments have separate existing limits.
  The old `main` file `manifests/minutes_backfill_budget.json` is used only
  as a migration seed if the independent ref does not yet exist; existing
  reservations are preserved. Later metadata updates do not touch `main` or
  trigger Pages. Stale concurrent budget pushes fail rather than overwrite
  another reservation.
- The 03:30 KST recovery trigger is retained for missed or failed processing.
  Its document/group settings are aligned to 20/160 with the normal dispatch.
- Historical batches run one at a time. Their planner and publisher take the
  existing shared data-repository lock; inference runs outside it. Recent-data
  jobs can publish while historical workers process their immutable snapshot.

## Partitioning and merge

The planner pins the data Git commit and canonical member-context hash. It
assigns oldest eligible whole documents to the least-loaded worker, up to 160
planned groups or 20 documents per worker. Every document belongs to one worker.
A very large document occupies one worker while other documents make progress.
Workers use public read access and sparse checkout: only the pinned document
index, member calendar, existing summary artifacts, and assigned transcript
files are materialized. Unassigned originals and archived versions stay in the
source repository. Workers checkpoint only their changed document artifacts,
and do not regenerate public exports or push data.

The publisher clones the current data head and validates the plan, worker ID,
transcript checksum, model, prompt, member context, speaker anchor, and exact
ordered source-sentence selection. It reconstructs source and bill metadata from
the current transcript. It unions groups by ID, retains already-published choices,
and recomputes completion and retry state. Changed sources are deferred rather
than replaced. Missing workers do not discard surviving valid output; publication
then reports failure. Invalid selections or provenance prevent publication.
Only a fully generated export/state set enables the Git push step.

Transient plan and worker artifacts expire after one day and are deleted from
the successful run after durable data publication. No raw corpus or model is
uploaded as a worker artifact. The model uses the existing shared Actions cache.
Built analytical artifacts also expire after one day; their published contents
remain in the data repository. Diagnostic artifacts retain their existing
seven-day window, and ingest snapshots retain their existing recovery policy.

## Publication

Historical batches commit validated source excerpts without dispatching a full
analysis build after every batch. Refresh-only runs at 09:45 and 21:45 KST compare
the summary index timestamp/count against the analysis index and dispatch the
existing live-data build only when needed. These runs do not load the model.
Normal ingest-driven builds can also incorporate the accumulated excerpts.
Successful data builds retain the explicit web deployment dispatch.

Between refreshes, summary exports may be newer than member analyses. A failed
refresh is retried by the next scheduled slot; monitoring rejects an outstanding
analysis refresh once the last analytical publication is older than 24 hours.

Manual operations use the existing workflow:

```sh
gh workflow run summarize-minutes.yml --ref main -f run_mode=backfill
gh workflow run summarize-minutes.yml --ref main -f run_mode=refresh
```

Manual historical work also consumes the same daily reservation budget.

## Measurement and expansion

`manifests/minutes_summary_state.json` includes remaining, ready, and deferred
group counts, the oldest pending meeting date, elapsed processing time, and a
time-limit flag. Grouping is counted without model calls and cached by transcript
SHA-256, grouping policy version, and member identity. Changed source bytes or
member context invalidate cached counts. A cached count never establishes that
a group was processed.

`manifests/minutes_summary_history.json` retains 14 days of completed batch
measurements. The state includes a seven-day observed rate, incoming document
delta, net backlog change, and estimated remaining processing minutes. No
arrival-rate claim is made from one observation; estimates exclude future
discovery, deployment overhead, and retry waiting time.

Wall elapsed time includes worker execution and publication queue delay. Aggregate
worker processing milliseconds are reported separately as `workerElapsedMs`;
the merge duration alone is never used as inference throughput. Worker capacity
is an upper bound, not a guaranteed successful excerpt count.

The first historical production batch completed eight documents and published
160 new excerpts in 19.2 processing minutes (run 40052375089). Its full census
found 141,081 remaining groups across 1,858 incomplete transcripts. All 1,928
official document IDs and all 149,039 cached group IDs were unique. The
historical eight-slot ceiling allows at most 1,280 attempted groups per day:
about 110 days for this backlog alone, excluding incoming work and the regular
recent-data batch. The earlier document-based 9–15 day estimate is not a valid
corpus-wide forecast. The user subsequently chose a 2–3 week target and parallel processing expansion.
Eight workers across eight daily slots allow up to 10,240 attempted groups per
day, approximately 14 days for that measured backlog before new arrivals,
failures, queue delays, and underfilled tail partitions. Validate the target
against actual parallel production runs; do not treat the capacity calculation
as an observed completion date. Public standard GitHub-hosted runner execution
is free; artifact/cache storage has separate limits and transient outputs are
bounded as described above.
