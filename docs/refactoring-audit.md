# Refactoring Audit

Updated: 2026-07-27

## Evaluation Criteria

The audit prioritizes code that combines unrelated responsibilities, duplicates
policy decisions, hides operational coverage, or makes high-impact behavior
difficult to test without external services. File length is a signal, not a
standalone reason to split code.

## Refactored in This Change

| Area                       | Problem                                                                                         | Refactoring                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Assembly minutes discovery | Search-window, backfill, and cursor policy lived inside a Playwright orchestration script       | Extracted pure policy into `assembly-mirror-policy.ts` with focused tests      |
| Minutes metadata           | Viewer headers could override trusted catalog dates and titles                                  | Made catalog metadata authoritative when the viewer header date conflicts      |
| Transcript migration       | Existing transcript JSON had no parser-version marker                                           | Added parser-version metadata and bounded refresh candidates                   |
| Summary progress           | `remainingDocuments: 0` obscured the size and freshness of the mirrored corpus                  | Added mirrored, transcript, summarized, and latest-date coverage fields        |
| Member asset UI            | Chart shaping, category ordering, and composition math lived inside a 3,000-line page component | Extracted the pure chart model into `activity-asset-charts.ts` with unit tests |

## Remaining Structural Hotspots

These boundaries should be refactored independently, with characterization
tests added before moving behavior.

| Priority | File                                               | Approximate size | Recommended boundary                                                                                                 |
| -------- | -------------------------------------------------- | ---------------: | -------------------------------------------------------------------------------------------------------------------- |
| P1       | `apps/web/src/components/ActivityCalendarPage.tsx` |      3,278 lines | Split member asset, vote record, committee, and calendar views into feature components; keep route state in the page |
| P1       | `packages/ingest/src/exports.ts`                   |      2,184 lines | Split vote exports, accountability exports, bill activity exports, calendar exports, and manifest serialization      |
| P1       | `packages/ingest/src/property-disclosures.ts`      |      1,618 lines | Separate PDF tokenization, disclosure parsing, member matching, and public artifact construction                     |
| P1       | `packages/ingest/src/scripts/mirror-documents.ts`  |      1,659 lines | Continue separating source adapters, network collection, persistence, and orchestration; policy is now isolated      |
| P2       | `apps/web/src/v2/V2ObservatoryPage.tsx`            |      1,333 lines | Separate lens data models and chart panels from page-level interaction state                                         |
| P2       | `packages/ingest/src/constituency-boundaries.ts`   |      1,308 lines | Separate source normalization, topology repair, and export packaging                                                 |
| P2       | `apps/web/src/components/DistributionPage.tsx`     |      1,149 lines | Extract comparison lenses and chart/table presentation components                                                    |
| P2       | `apps/web/src/components/HexmapPage.tsx`           |      1,107 lines | Extract selection panel, cartogram renderer, and member evidence panel                                               |
| P2       | `packages/ingest/src/scripts/ingest-live.ts`       |      1,045 lines | Move endpoint-specific fetch plans and snapshot assembly into testable modules                                       |

## Refactoring Guardrails

- Preserve published JSON contracts and workflow triggers.
- Add characterization tests before moving calculations or parsing behavior.
- Keep source-specific failures visible in state files instead of converting
  partial coverage into apparent success.
- Prefer feature or policy boundaries over arbitrary line-count splits.
- Avoid combining visual redesign with data-pipeline refactoring in the same
  change unless a contract must change.
