# Lawmaker Monitor

Lawmaker Monitor is a public web app and data pipeline for tracking plenary vote activity and asset disclosure history in the National Assembly of Korea. The project collects official upstream data, normalizes it into stable datasets, publishes lightweight JSON exports, and renders those exports in a static client.

The current product is organized around two main views. The home view focuses on recent vote activity and accountability signals, while the calendar view helps readers inspect participation patterns, compare individual lawmakers over time, and review published asset disclosure history for current members of the 22nd Assembly.

## What The App Shows

- Accountability leaderboard for lawmakers in the current assembly
- Latest vote feed with official tallies, highlighted no or abstain votes, and verified absences
- Weekly accountability trend summaries for the assembly
- Member search from the published ranking data
- Member activity calendar with per-day participation states
- Compare mode for viewing two members side by side in the calendar experience
- Shareable deep links for member and compare views
- Lazy member detail loading so detailed vote records are fetched only when needed
- Member asset disclosure history in the calendar view for current 22nd Assembly lawmakers
- Asset summary cards with latest total, first disclosure date, latest disclosure date, and cumulative delta
- Category toggles for asset subtotal series plus a real-estate-focused readout for land and building categories
- Scope toggle for family-included totals versus self-only totals when item-level disclosure parsing supports it

## Repository Layout

- `apps/web`: Vite + React frontend deployed to GitHub Pages
- `packages/ingest`: ingestion scripts, parsers, normalization, export builders, source monitoring, and document mirroring
- `packages/schemas`: shared Zod schemas and TypeScript types for normalized records and published contracts
- `tests/fixtures`: fixed upstream payload fixtures used by pipeline and parser tests
- `.github/workflows`: scheduled and manual workflows for ingest, build, deployment, monitoring, and document mirroring

## Data Flow

1. `ingest-live` fetches official Assembly API payloads and writes a raw snapshot artifact for vote, member, committee, and meeting data.
2. `mirror-property-disclosures` queries the official Assembly file-service JSON listing for property disclosure PDFs, mirrors the files into the public data repository, and refreshes a JSON-only property member context cache.
3. `build-data` reads the raw ingest snapshot plus the mirrored property inputs from the public data repository, builds normalized datasets, and publishes public exports plus a manifest.
4. `deploy-web` builds the frontend against the published data base URL and deploys the static site to GitHub Pages.
5. `monitor-sources` checks official upstream payloads for changes that could break parsing assumptions.
6. `mirror-documents` mirrors other public Assembly documents into the public data repository and updates mirror state metadata.

This repository owns the application code, schemas, tests, and workflow orchestration. Published datasets and exports are meant to live in a separate public data repository referenced by the web app at runtime.

The asset disclosure path is intentionally split from the XML-derived vote snapshot path. Property mapping uses a JSON-only cached roster and tenure context built from official Assembly OpenAPI responses and does not depend on the XML member snapshot used by the main vote pipeline.

## Published Data

The frontend reads public JSON exports and validates them with the schemas package.

- `exports/latest_votes.json`: home feed payload for recent plenary votes
- `exports/accountability_summary.json`: ranked lawmaker summary used by the leaderboard and search
- `exports/accountability_trends.json`: weekly trend points and mover windows for the overview charts
- `exports/member_activity_calendar.json`: calendar summary payload for the current assembly
- `exports/member_activity_calendar_members/<memberId>.json`: lazily loaded member vote record details
- `exports/member_assets_index.json`: current-member asset disclosure index with latest summary and per-member history pointers
- `exports/member_assets_history/<memberId>.json`: lazily loaded member asset disclosure history and category subtotal series
- `curated/asset_disclosures.parquet`: mirrored disclosure file metadata
- `curated/asset_disclosure_records.parquet`: parsed disclosure record summaries per named filer
- `curated/asset_disclosure_categories.parquet`: parsed category subtotal rows per disclosure record
- `curated/asset_disclosure_items.parquet`: parsed asset item rows with relation and detail text fields when available
- `manifests/latest.json`: manifest with dataset and export metadata, checksums, and current assembly information

Shared contracts for these files are defined in `@lawmaker-monitor/schemas`.

## Local Development

Install dependencies and run the shared checks:

```bash
npm install
npm run build
npm test
npm run typecheck
```

Useful commands during development:

```bash
npm run dev:web
npm run ingest:live --workspace @lawmaker-monitor/ingest
npm run build:data --workspace @lawmaker-monitor/ingest
npm run sync:property-member-context --workspace @lawmaker-monitor/ingest
npm run test:ui
```

UI flow coverage and screenshot outputs are documented in `docs/testing/ui-test-cases.md`.

Additional operational scripts:

```bash
npm run mirror:documents --workspace @lawmaker-monitor/ingest
npm run sync:property-member-context --workspace @lawmaker-monitor/ingest
npm run monitor:sources --workspace @lawmaker-monitor/ingest
```

## GitHub Actions Workflows

- `ingest-live`: runs the live ingest pipeline and uploads a raw snapshot artifact
- `build-data`: consumes a raw snapshot, builds normalized outputs, materializes public exports, and syncs them into the public data repository
- `deploy-web`: builds the frontend and deploys it to GitHub Pages
- `monitor-sources`: checks upstream source stability and opens an incident issue when parser assumptions fail
- `mirror-documents`: mirrors public Assembly documents into the public data repository
- `mirror-property-disclosures`: mirrors official property disclosure PDFs, refreshes property member context JSON caches, and publishes those raw inputs into the public data repository

## Supported Ingest Environment Variables

Only the following Assembly ingest variables are part of the supported surface and should be documented or configured for the live ingest workflow:

- `ASSEMBLY_API_KEY`
- `ASSEMBLY_PAGE_SIZE`
- `ASSEMBLY_BILL_FEED_CONCURRENCY`
- `ASSEMBLY_VOTE_DETAIL_CONCURRENCY`
- `ASSEMBLY_BILL_VOTE_SUMMARY_CONCURRENCY`
- `ASSEMBLY_FETCH_TIMEOUT_MS`
- `ASSEMBLY_FETCH_RETRIES`

`ASSEMBLY_API_KEY` is required for production-like ingest runs. The remaining values tune page size, concurrency, timeout, and retry behavior for official API collection.

## Operational Settings

The project also uses repository or local settings for data publication and document mirroring.

Data publication settings:

- `DATA_REPO`
- `DATA_REPO_BRANCH`
- `DATA_REPO_BASE_URL`
- `DATA_REPO_PAT`

Public document mirror settings:

- `MIRROR_MODE`
- `MIRROR_SOURCE_ID`
- `MIRROR_START_URL`
- `MIRROR_READY_SELECTOR`
- `MIRROR_ROW_SELECTOR`
- `MIRROR_TITLE_SELECTOR`
- `MIRROR_LINK_SELECTOR`
- `MIRROR_LINK_ATTRIBUTE`
- `MIRROR_DATE_SELECTOR`
- `MIRROR_NEXT_SELECTOR`
- `MIRROR_MAX_PAGES`
- `MIRROR_MAX_DOWNLOADS`
- `MIRROR_PAGE_DELAY_MS`
- `MIRROR_TIMEOUT_MS`
- `MIRROR_TIME_ZONE`
- `MIRROR_RECENT_DAYS`
- `MIRROR_BACKFILL_START_DATE`
- `MIRROR_BACKFILL_DAYS`
- `MIRROR_INCLUDE_APPENDICES`

Property disclosure mirror settings use the same document mirror infrastructure plus Assembly file-service specific inputs:

- `MIRROR_SERVICE_INF_ID`
- `MIRROR_SERVICE_INF_SEQ`
- `MIRROR_INDEX_PATH`
- `MIRROR_STATE_PATH`
- `PROPERTY_SOURCE_ID`
- `PROPERTY_MEMBER_CONTEXT_MANIFEST_PATH`
- `PROPERTY_MEMBER_INFO_PATH`
- `PROPERTY_MEMBER_HISTORY_PATH`

See `.env.example` for a concrete local configuration template.

## Source Policy

Lawmaker Monitor is built around official Assembly sources for vote, meeting, member, committee, and related plenary data. The asset disclosure pipeline also stays on official Assembly surfaces: the property PDF list comes from the public file-service JSON endpoint, and property member mapping comes from cached official JSON OpenAPI responses for current member roster and member history. The ingest pipeline, source monitoring checks, and public export contracts are all designed around keeping that official-source path stable over time.

## Reference Material

- `docs/references/assembly-openapi-reference.md`: concise human-readable notes about the Assembly OpenAPI surface used by this project
- `docs/references/assembly-openapi-endpoints.json`: machine-readable endpoint registry for prompts, tooling, and automation

## Open Source Dependencies

Lawmaker Monitor depends on a small set of open source tools and libraries.

- [React](https://react.dev/)
- [Vite](https://vite.dev/)
- [Recharts](https://recharts.org/)
- [Zod](https://zod.dev/)
- [Vitest](https://vitest.dev/)
- [TypeScript](https://www.typescriptlang.org/)
