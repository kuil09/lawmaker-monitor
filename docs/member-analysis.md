# Member history analysis

The analytical build uses the pinned, checksum-verified DuckDB 2.0.0 CLI. It
publishes typed Parquet tables, a small directory, and one JSON document per
member. The website remains a static Pages application. No query server, paid
model, or browser database is required.

## Delivered analyses

1. Career and activity: explicitly matched occupations in official biographies
   are linked to title/excerpt keyword topics, retaining the supporting text.
2. Transitions: dated official tenure and committee periods support 90-day
   before/after counts. Observed party/role snapshots do not establish a change
   date and are excluded from this causal-looking comparison.
3. Peers: shared current committees, reelection label, and election type determine
   the comparison order. Participation denominators include only public recorded
   votes during each member's official tenure; missing records stay unknown.
4. Cross-party voting: explicit yes/no/abstain choices, at least five shared votes
   in a topic while in different parties, and less than 95% consensus within the
   current analytical member cohort. Parties
   come from individual vote records, never today's roster.
5. Topic continuity: monthly counts and source records can be filtered by period,
   activity, and topic. These are observed interests; campaign-promise compliance
   is not inferred without a collected promise dataset.
6. Asset/role chronology: matched official family-inclusive asset disclosures are
   joined to dated roles. Valuation changes remain separate; an overlap does not
   establish misconduct or a financial return caused by office.

## Evidence and time semantics

- Identity joins use official member IDs. Same-name people are not merged across
  assemblies. Cross-assembly links exist only when official IDs match.
- Dated committee source rows use the existing unique-name resolver within the
  current assembly; ambiguous names are excluded. Each period keeps its source
  page. Tenure periods preserve their official history source page.
- Observations retain first/last observed timestamps when the same party and role
  persist. An observed date is explicitly distinguished from an effective date.
- Undated biography claims remain undated. Explicit year/month/day prefixes are
  retained with their original precision; a standalone date is a dated mention,
  not an indefinite appointment. A graduation year is not interpreted as the
  start of employment, including flattened graduation/job text in one clause.
  Biography periods are separately styled and excluded from the 90-day official
  role comparison. Categories are heuristic navigation aids.
- Monthly aggregates use all available records. Source previews contain at most
  the latest 500 activities per member; the screen shows 40 matching previews.
- Statement counts cover collected, successfully exported minutes only. Missing
  minutes or unclassified careers do not mean inactivity or lack of experience.
- The first/last activity dates describe the available activity range, not proof
  of complete coverage on every day. Before/after overlap days share this limit.

## Build and verification

The existing normalized build writes `analysis-input/`. After Parquet generation:

```sh
bash scripts/install-duckdb.sh /tmp/lawmaker-duckdb
DUCKDB_BIN=/tmp/lawmaker-duckdb/duckdb node scripts/build-member-analysis.mjs artifacts/build
```

The analysis builder rejects a non-2.0.x engine and validates every published
document against the shared schemas. It extends the main manifest with hashes
of the actual analysis files. Existing datasets retain their public Parquet
interface; the browser does not consume a new native `.duckdb` file format.

PR CI runs the analytical SQL with a verified 2.0 engine. Its controlled case
checks late tenure, absent source records, historical parties, consensus
exclusion, identity ambiguity, and an empty statement dataset. Responsive UI
flows exercise the directory, career/topic filters, comparisons, and sources.

The new Parquet results must also be compared against the previous CLI on the
same normalized input before production migration. Production verification must
check the real analytical export, published checksums, and the rendered route;
fixture tests alone do not establish source coverage or delivery.
