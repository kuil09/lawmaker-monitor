# UI Test Cases

## Purpose

This suite verifies the main public user flows with deterministic fixture data, viewport coverage, and screenshot evidence.

## Fixture-Covered Routes

- `home`
- `#calendar?member=M002`
- `#calendar?member=M002&compare=M001&view=compare`

## Viewport Matrix

- `390x844` mobile
- `768x1024` tablet
- `1440x900` desktop

## Automated Scenarios

### 1. Home Overview

- Open the home route with the published fixture set.
- Verify the briefing header, leaderboard heading, trend section, and feed controls are visible.
- Capture `.artifacts/ui/<viewport>/home.png`.

### 2. Search To Single-Member Calendar

- Type a lawmaker query from the home command panel.
- Verify hash navigation to `#calendar?member=M002` in the fixture-backed UI test run.
- Verify the single-member calendar loads the lazy vote record detail.
- Confirm the calendar auto-scrolls to the latest visible dates.
- Capture `.artifacts/ui/<viewport>/calendar-single.png`.

### 3. Calendar Help And Horizontal Scroll

- Open the help copy on the calendar page.
- Verify the explanatory summary becomes visible.
- Reset the calendar viewport and dispatch a wheel interaction.
- Confirm the calendar scroll position changes.
- Capture `.artifacts/ui/<viewport>/calendar-help.png`.

### 4. Compare View

- Switch from `개인 분석` to `VS 비교`.
- Select a second member in the compare search field.
- Verify the compare summary and both member identities are visible.
- Open the fixture compare deep link directly and verify the compare tab remains selected.
- Capture `.artifacts/ui/<viewport>/calendar-compare.png`.

## Production Verification Routes

The fixture routes above are only for local UI automation. Shared verification against GitHub Pages or the published data repository must resolve live member IDs from the current manifest instead of reusing `M002` or `M001`.

Resolve the current production URLs with:

```bash
npm run resolve:production-ui-routes
```

The command fetches `manifests/latest.json`, follows the published `member_activity_calendar.json` path, sorts current assembly members by `name` and `memberId`, probes published member detail files, and prints the exact single-member and compare URLs that are live for the current snapshot.

When leaving shared verification evidence, include:

- `snapshotId`
- `single.url`
- `compare.url`
- screenshot evidence for the single-member header and compare ratio table

Use a shared comment shape that leaves the exact command output easy to audit:

```md
## verified-shared

- ref: `<commit-or-branch>`
- validation:
  - `npm test -- tests/ingest/resolve-production-ui-routes.test.ts`
  - `npm run resolve:production-ui-routes`
- snapshotId: `<snapshotId>`
- single.url: `<single.url>`
- compare.url: `<compare.url>`
- screenshots:
  - `<single header screenshot path or URL>`
  - `<compare ratio table screenshot path or URL>`
```

## Execution

```bash
npm run test:ui
```

The command rebuilds the shared schemas package, rebuilds the web app against a local fixture base URL, starts local app and data servers, runs the browser automation, and writes screenshots plus `.artifacts/ui/manifest.json`.
