# Minutes evidence pipeline audit

Audited on 2026-10-23 (Asia/Seoul), against application main `55c536e` and
public data commit `445544cbe69f6256f2e96a0e84dc2452d9ebaf08`.

## Findings

| Boundary                | Observed baseline                                                                                                                                     | Consequence                                                                                                                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Discovery and mirroring | 1,903 indexed files, including one legacy appendix; 1,901 transcripts                                                                                 | A mirrored file is not necessarily a usable minutes body.                                                                                                                                                                           |
| Summary processing      | 165 fully processed transcripts, 1,736 incomplete; 9,713 published excerpts for 284 members                                                           | A successful bounded batch did not establish full coverage. Partial documents can publish individual validated excerpts.                                                                                                            |
| Bill/vote join          | 92 of 1,911 roll calls had a matching summarized bill number; 85 had a participating speaker's public choice, yielding 806 evidence rows              | Missing connections can reflect processing coverage or an unresolved speaker choice, rather than missing files. Exact bill IDs must remain required; similar titles are insufficient.                                               |
| Public file references  | All indexed raw/transcript/metadata/member-export paths existed in the data repository                                                                | Repository path absence was not the main cause. Public HTML and anchors were separately checked.                                                                                                                                    |
| Semantic attribution    | Minutes 56737, `#spk_16` and `#spk_54`, were attached to bill 2212713 using CSS `item19`; the actual discussion concerned other bills                 | A working URL and anchor did not establish a correct bill attribution. Joint agenda introductions can leave all later speakers with the final agenda's CSS class.                                                                   |
| Analysis publication    | Member analysis contained 9,556 statements while the current summary export contained 9,713                                                           | Summary publication did not rebuild the derived analytical datasets.                                                                                                                                                                |
| UI                      | The generic minutes homepage was labelled as a minutes link; missing member summaries hid the section; the vote route ignored its evidence-load error | Users could mistake an unavailable dataset or incomplete processing for an absence of speech.                                                                                                                                       |
| Recovery                | Summary retries ran without checkout or `GH_REPO`; summaries depended on successful mirror dispatch                                                   | The retry job lacked repository context. Mirror failures could prevent an otherwise useful summary batch from starting. This retry configuration defect was identified statically; the audited recent summary runs were successful. |
| Monitoring              | Only per-run failures were checked; summary freshness was exempted                                                                                    | A stalled backlog could coexist with a green monitor.                                                                                                                                                                               |

Source examples:

- [Official minutes 56737, speech 16](https://record.assembly.go.kr/assembly/viewer/minutes/xml.do?id=56737&type=view#spk_16)
- [Successful bounded summary batch](https://github.com/kuil09/lawmaker-monitor/actions/runs/39858454127): 7 visited documents, 6 completed, 157 groups, 1,736 remaining.
- [09:20 KST ingest failure](https://github.com/kuil09/lawmaker-monitor/actions/runs/39877560751): the official member API timed out connecting on port 443 after the configured retries. The dependent build and deployment were skipped; no empty replacement was published.
- [Public summary state](https://kuil09.github.io/lawmaker-monitor-data/manifests/minutes_summary_state.json)
- [Public summary directory](https://kuil09.github.io/lawmaker-monitor-data/exports/member_statement_summaries/index.json)

## Repair and publication procedure

1. Summary policy v8 stops using a CSS agenda class as bill evidence when a
   document lists multiple agenda items. Unresolved member speeches remain
   general speeches without inferred bill IDs. A unique textual bill reference
   or a single matching agenda can still support the existing exact-ID join.
2. Before a summary batch, `--rebind-agendas` migrates current v7 artifacts using
   the indexed transcript bytes and verifies their SHA-256. An existing selected
   excerpt is reused only if every sentence occurs in the new group for the same
   member and its original anchor is included in that group. No model is called.
   Unmatched selections are withheld; uncovered groups remain pending. A repeat
   repair with no legacy artifacts makes no publication changes.
3. The existing bounded model batch processes at most 20 documents / 160 groups.
   Partial progress is published before a failing run is reported. Published
   migrations or newly selected excerpts dispatch `build-data` using the latest
   successful ingest artifact, refreshing analysis even during an upstream API
   outage. The normal data build also recomputes vote evidence from its new vote
   records and current transcript hashes, without another model call.
   After successful data publication and artifact upload, the build explicitly
   dispatches `deploy-web`. Summary completion does not launch a duplicate,
   earlier app deployment. A scheduled no-op recovery check therefore does not
   rebuild the app. The build job has `actions: write` for this explicit dispatch;
   Pages permissions and its protected environment remain in the deployment job.
4. A daily independent recovery check at 03:30 KST runs a bounded summary batch
   if work remains and the last run is at least 18 hours old, or reports failed
   groups. A recent successful nightly batch is not duplicated. Retries explicitly
   select the repository and retain their existing three-retry cap. There is no
   unbounded success-triggered dispatch chain.
5. Monitor source failures and the last actual summary progress separately. An
   incomplete backlog with no progress for 48 hours fails monitoring. A successful
   batch continues to report the outstanding count; it is not a coverage guarantee.
6. The UI displays processing coverage, distinguishes evidence request failures
   from unmatched votes, retains an explicit empty member section, and rejects
   mixed member index/detail generations. Pre-v8 bill evidence is withheld during
   repair. Preserved-source links include the speech anchor; the generic official
   homepage is explicitly labelled as a search destination.

All data writers continue to use the shared serialized publication queue.
Existing source files, transcript versions, and v5 quarantined artifacts are
preserved. The repair changes attribution and reuse eligibility, not the quoted
source wording. Policy v8 is an agenda-binding revision of the extractive ranker;
reused selections do not imply that the model was called again.

The production build [39882426730](https://github.com/kuil09/lawmaker-monitor/actions/runs/39882426730),
dispatched by the summary workflow, succeeded without creating the expected
`workflow_run` app deployment. The final procedure uses explicit dispatch at both
handoffs. This matches the documented exception to the default token's event
recursion prevention: [`workflow_dispatch` starts a new workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow).
Configuration checks alone did not establish this deployment boundary.

## Verification and remaining coverage limits

The local production-data rehearsal rebound 182 v7 artifacts and retained 8,273
source-matching excerpts for 281 members. With the full published member vote
records, 63 roll calls retained 151 evidence rows; the two incorrect 56737/bill
2212713 connections disappeared. Only 43 documents were complete under the new
grouping; 1,858 remained incomplete before the next model batch. These figures
describe the rehearsal, not a claim that historical backfill has finished.

Do not use workflow success, a current latest meeting date, or an HTTP 200 as a
substitute for coverage or semantic source validation. The 1,858-document backlog
requires further bounded batches; the recovery check prevents missed execution
but does not increase normal processing capacity. New historical coverage still
depends on the official catalog, source availability, and the retained download
and model budgets. A legacy appendix is not a missing minutes transcript, and an
explicitly empty temporary official body remains pending without fabricating
speeches. No automatic loop should be added to drain the entire backlog without
an explicit resource budget.
