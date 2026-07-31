# Minutes Reclassification Verification

Use this runbook after starting or restarting the `summarize-minutes` workflow.
A green workflow run is necessary, but it is not sufficient evidence that the
full reclassification is complete. The workflow may publish one bounded batch
and dispatch another batch while documents remain.

The normal unattended sequence is:

1. the daily `mirror-documents` run publishes newly discovered official
   transcripts;
2. the successful mirror explicitly starts `summarize-minutes`;
3. the summary workflow continues checkpointed batches until no documents
   remain; and
4. each successful summary batch makes `deploy-web` eligible to publish the
   updated site.

Mirror and summary failures are retried up to three times. Generated-data pushes
also retry transient fetch and push failures. A manual cancellation remains
final so an operator can intentionally stop processing.

## Repositories and expected classifier

```bash
export APP_REPO="kuil09/lawmaker-monitor"
export DATA_REPO="kuil09/lawmaker-monitor-data"
export EXPECTED_PROMPT_VERSION="minutes-summary-v7-extractive-ranker"
```

The expected publication properties are:

- `sourceKind`: `official_minutes_transcript`
- `promptVersion`: `minutes-summary-v7-extractive-ranker`
- the configured model ID, normally
  `LGAI-EXAONE/EXAONE-4.0-1.2B-GGUF:Q8_0`
- published summary text copied from the collected minutes rather than
  model-authored prose

## 1. Find and monitor the active run

List the latest summary runs:

```bash
gh run list \
  --repo "$APP_REPO" \
  --workflow summarize-minutes.yml \
  --limit 10 \
  --json databaseId,status,conclusion,createdAt,event,headSha \
  --jq '.[] | {
    id: .databaseId,
    status,
    conclusion,
    createdAt,
    event,
    head: (.headSha[0:7])
  }'
```

Set the run ID and watch it:

```bash
export RUN_ID="<run-id>"
gh run watch "$RUN_ID" --repo "$APP_REPO" --exit-status
```

GitHub keeps the same run ID when a canceled run is restarted with **Re-run
jobs**. Always inspect the current status instead of assuming that an old
`cancelled` result is still final.

Inspect the final step states:

```bash
gh run view "$RUN_ID" \
  --repo "$APP_REPO" \
  --json status,conclusion,jobs \
  --jq '{
    status,
    conclusion,
    steps: [.jobs[].steps[] | {
      name,
      status,
      conclusion
    }]
  }'
```

For a successful publication batch, these steps must complete:

1. `Summarize new member statements`
2. `Read summary progress`
3. `Commit and push summary changes`
4. `Continue pending minutes summaries`, when documents remain

If the run fails, collect the failing logs before restarting it:

```bash
gh run view "$RUN_ID" --repo "$APP_REPO" --log-failed
```

## 2. Verify the published progress state

Download a cache-busted copy of the state file:

```bash
curl -fsSL \
  "https://raw.githubusercontent.com/${DATA_REPO}/main/manifests/minutes_summary_state.json?ts=$(date +%s)" \
  -o /tmp/minutes_summary_state.json

jq '{
  updatedAt,
  modelId,
  promptVersion,
  sourceKind,
  documentsVisited,
  documentsCompleted,
  groupsSummarized,
  groupsFailed,
  mirroredDocuments,
  transcriptDocuments,
  summarizedDocuments,
  remainingDocuments,
  latestMirroredMeetingDate,
  latestSummarizedMeetingDate,
  membersPublished
}' /tmp/minutes_summary_state.json
```

Run the machine-readable acceptance check:

```bash
jq -e --arg prompt "$EXPECTED_PROMPT_VERSION" '
  .promptVersion == $prompt
  and .sourceKind == "official_minutes_transcript"
  and .groupsFailed == 0
  and .remainingDocuments == 0
  and .summarizedDocuments == .transcriptDocuments
  and .latestSummarizedMeetingDate == .latestMirroredMeetingDate
' /tmp/minutes_summary_state.json
```

The full reclassification is complete only when this command exits with status
`0`. In particular:

- `remainingDocuments > 0` means another summary batch is still required.
- `summarizedDocuments < transcriptDocuments` means coverage is incomplete.
- Different latest meeting dates mean the newest mirrored minutes have not
  reached the active classifier.
- `groupsFailed > 0` requires log inspection and another run.

The state describes the latest published batch. Confirm that `updatedAt` is
newer than the run being accepted.

## 3. Confirm that the data repository received a commit

```bash
gh api -X GET "repos/${DATA_REPO}/commits" \
  -f path="manifests/minutes_summary_state.json" \
  -f per_page=1 \
  --jq '.[0] | {
    sha: .sha,
    date: .commit.committer.date,
    message: .commit.message,
    url: .html_url
  }'
```

The commit time must be after the accepted summary batch. If the Actions run is
green but this commit did not change, inspect the `Commit and push summary
changes` step rather than accepting the run.

## 4. Inspect a previously problematic member

Use Park Eun-jung and the 2026-07-22 minutes as the regression sample:

```bash
export MEMBER_ID="1A82234K"
export MEETING_DATE="2026-07-22"

curl -fsSL \
  "https://raw.githubusercontent.com/${DATA_REPO}/main/exports/member_statement_summaries/${MEMBER_ID}.json?ts=$(date +%s)" \
  -o "/tmp/${MEMBER_ID}.json"

jq --arg date "$MEETING_DATE" '{
  generatedAt,
  memberId,
  name,
  modelId,
  promptVersion,
  summaries: [
    .summaries[]
    | select(.meetingDate == $date)
    | {
        meetingTitle,
        committeeName,
        agendaTitle,
        summary,
        evidenceExcerpt,
        sourceKind,
        sourceUrl,
        sourceFragment,
        sourceDocumentPath
      }
  ]
}' "/tmp/${MEMBER_ID}.json"
```

Apply these checks:

1. `promptVersion` matches the expected extractive classifier.
2. Every result has `sourceKind = official_minutes_transcript`.
3. `summary` and `evidenceExcerpt` are identical.
4. The summary does not introduce a person, institution, number, causal claim,
   or conclusion that is absent from the cited statement.
5. Open `sourceUrl` and compare at least three summaries against the official
   minutes around `sourceFragment`.

The equality check can be automated:

```bash
jq -e '
  all(
    .summaries[];
    .sourceKind == "official_minutes_transcript"
    and .summary == .evidenceExcerpt
  )
' "/tmp/${MEMBER_ID}.json"
```

Scan for known regression tokens. No output is the expected result:

```bash
jq -r '.summaries[] | [.meetingDate, .summary] | @tsv' \
  "/tmp/${MEMBER_ID}.json" \
  | rg -n -i 'thorough|오펜하이머|당협위'
```

This token scan is only a regression check. It does not replace comparison with
the official source.

## 5. Inspect coverage outside the regression sample

Review at least:

- one government-party member
- one opposition-party member
- one proportional representative
- one constituency representative
- one plenary meeting statement
- one committee meeting statement

For each sample, verify the same source fields and compare the published sentence
with the official minutes. This catches attribution or segmentation errors that
a single member sample cannot reveal.

## 6. Verify the final web deployment

The `deploy-web` workflow is triggered after a successful summary workflow.
Find the deployment created after the final summary batch:

```bash
gh run list \
  --repo "$APP_REPO" \
  --workflow deploy-web.yml \
  --limit 10 \
  --json databaseId,status,conclusion,createdAt,headSha \
  --jq '.[] | {
    id: .databaseId,
    status,
    conclusion,
    createdAt,
    head: (.headSha[0:7])
  }'
```

Watch the selected deployment:

```bash
export DEPLOY_RUN_ID="<deploy-run-id>"
gh run watch "$DEPLOY_RUN_ID" --repo "$APP_REPO" --exit-status
```

After it succeeds, open a cache-busted member page:

```text
https://kuil09.github.io/lawmaker-monitor/?verify=<data-commit-sha>#calendar?member=1A82234K
```

Confirm that:

1. the 2026-07-22 record uses the newly published extractive summary;
2. the official source link opens the matching minutes;
3. no previous abstractive or unsupported sentence remains visible; and
4. the displayed collection date is not older than the accepted data commit.

## Acceptance summary

Accept the reclassification only when all of the following are true:

- the final `summarize-minutes` run succeeded;
- no continuation batch remains queued or running;
- the state acceptance command exits with status `0`;
- the data repository contains a newer summary commit;
- the Park Eun-jung regression sample passes source comparison;
- the cross-member sample passes source comparison; and
- the final `deploy-web` run succeeded and production shows the new data.
