# Design QA

## Evidence

- Watch Queue design target: `/tmp/watch-share-visuals.fGTEbp/home.png`
- Selected member-card option 1: `/Users/gun9/.codex/generated_images/019f915e-92a0-7650-bf31-0ac7378fa4e6/call_43weW8KraNkVAAMPJYXjhruw.png`
- Final option-1 member card: `/Users/gun9/Developer/lawmaker-monitor/apps/web/dist/member-cards/T2T8225E.png`
- Option-1 source and implementation comparison: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/member-card-option-1-source-vs-final.png`
- Option-1 300 × 158 social thumbnail: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/member-card-option-1-thumbnail.png`
- Final Watch Queue implementation: `/Users/gun9/Developer/lawmaker-monitor/artifacts/watch-queue-home-final-1440x900.jpg`
- Final normalized comparison input: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa-home-comparison.jpg`
- Final mobile Watch Queue: `/Users/gun9/Developer/lawmaker-monitor/artifacts/watch-queue-home-final-390x844.jpg`
- Final member share and sponsorship modules: `/Users/gun9/Developer/lawmaker-monitor/artifacts/member-share-account-final-390x844.jpg`
- Generated member OG card: `/Users/gun9/Developer/lawmaker-monitor/apps/web/dist/member-cards/T2T8225E.png`
- Selected visual truth: `/Users/gun9/.codex/generated_images/019f915e-92a0-7650-bf31-0ac7378fa4e6/call_Jz2NmIfMjgolMs7EUbnULGP9.png`
- Repository source copy: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/v3-source-option-3.png`
- Final home implementation: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/v3-home-final-1280x720.jpg`
- Final deck.gl map implementation: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/v3-map-final-1280x720.jpg`
- Same-input side-by-side comparison: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/v3-source-vs-implementation-final.png`
- Responsive route evidence: `/Users/gun9/Developer/lawmaker-monitor/.artifacts/ui/{mobile,tablet,desktop}/v2-{home,calendar,distribution,map,votes,trends}.png`
- Jeju overlap source truth: `/tmp/codex-remote-attachments/019f915e-92a0-7650-bf31-0ac7378fa4e6/6ED04B8E-3BFA-45FF-ACA4-D1ED8A224BA7/1-붙여넣은-이미지-1.jpg`
- Jeju overlap fixed implementation: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/jeju-legend-fixed-1176x1280.png`
- Jeju overlap mobile implementation: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/jeju-legend-fixed-mobile-390.png`
- Jeju focused side-by-side comparison: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/jeju-legend-source-vs-fixed.png`
- Jeju production verification: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/jeju-legend-production-1a98b62-1176x1280.png`
- Trend-toggle source truth: `/var/folders/3j/s53_zmzx43qb9v6xmsgxq9w80000gn/T/codex-clipboard-5e8692c5-62d8-437e-a6ff-526f8bf7ef34.png`
- Trend-toggle fixed implementation: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/trend-toggle-fixed-370x348.png`
- Trend-toggle side-by-side comparison: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/trend-toggle-source-vs-fixed.png`
- Scatter-tooltip source truth: `/var/folders/3j/s53_zmzx43qb9v6xmsgxq9w80000gn/T/codex-clipboard-da83c39a-a5d8-4f2f-829b-ff2c316ece99.png`
- Scatter-tooltip fixed implementation: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/scatter-tooltip-fixed-desktop.png`
- Scatter-tooltip side-by-side comparison: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/scatter-tooltip-source-vs-fixed.png`

## Comparison Input

- Source comparison viewport: 1280 × 720 top crop
- Implementation comparison viewport: 1280 × 720
- Browser density: DPR 2 in the in-app browser; responsive automation uses DPR 1
- Compared state: V2 overview, attendance lens, current production data, 298 members
- Comparison method: the selected source and final implementation were normalized to the same viewport and composited into one 2560 × 720 image before visual judgment.
- Jeju regression viewport: 1176 × 1280 at DPR 1, with an additional 390 × 844 responsive measurement.
- Jeju regression method: the user-provided source and fixed browser capture were normalized to 1176 × 1280 and composited into one 2352 × 1280 image. Bounding rectangles for the three rendered Jeju constituencies and the legend were also measured directly.
- Trend-toggle regression viewport: 390 × 844 at DPR 1, compared with the user's DPR 2 narrow-browser capture after both cards were normalized to 638 × 744.
- Scatter-tooltip regression viewport: 1440 × 900 at DPR 1. The user-provided wide-browser source and the fixed hovered implementation were normalized into one 1136 × 724 comparison image.

## Target Direction

- Information architecture: persistent masthead and search, compact page context, left comparison rail, central geographic or evidence workspace, right insight rail, and lower evidence sections.
- Theme: warm newsprint paper, black editorial ink, oxblood accountability signals, ochre caution context, and warm neutral source states. Civic teal is prohibited.
- Shape language: flat evidence sheets, hard rules, restrained radii, no glass treatment, no decorative gradients, and no 3D presentation.
- Typography: dense Korean newspaper hierarchy with editorial display titles, compact labels, and tabular evidence data.
- Product boundary: all six V2 routes use the same shell and tokens while retaining the real data, official links, deep links, and existing CI/CD workflow.

## Required Fidelity Surfaces

- Shell and navigation: all routes share a 1440 px maximum content width, five primary destinations, persistent member search, route focus management, and a mobile menu.
- Overview: the selected three-column monitoring workspace is reproduced with a rank rail, national absence map, decision-oriented insight rail, lower scatter/trend evidence, and table alternatives.
- Member activity: the prior visual form was replaced with the same flat evidence system while preserving single-member and comparison workflows.
- Distribution: dense portrait scatter, focused member evidence, behavior signals, property comparison, and accessible filtering were restyled as one analytical workspace.
- Vote records: search, outcome filters, evidence links, and date groups use a bounded timeline. Production data renders 20 records at a time instead of mounting all 1,059 records.
- Trends: participation and party-line behavior use a shared dashboard grid, consistent metric strips, window controls, and raw-data tables.
- Geographic exploration: standalone deck.gl renders low-zoom `GeoJsonLayer` district boundaries and high-zoom province-separated `H3HexagonLayer` cells. It has no place-name overlay or external basemap dependency.
- Accessibility: semantic headings and regions, keyboard lens tabs, route heading focus, 44 px mobile controls, DOM province/member alternatives for the canvas map, live result counts, and table fallbacks were verified.
- Responsive behavior: all six routes have no horizontal overflow at 390 × 844, 768 × 1024, and 1440 × 900.

## Comparison History

### Pass 1 — System Replacement

- P1: legacy masthead, hero, card radii, gradients, and divergent content widths remained across routes.
- P2: route headings and accent colors did not form a single product system.
- Fix: introduced the new shared shell, unified tokens, compact masthead/search, consistent cobalt accent, 1440 px content width, and route-level page headers.

### Pass 2 — Route Reconstruction

- P1: activity, distribution, vote, and trend routes still contained nested legacy visual panels.
- P1: the map depended on pointer-only canvas selection.
- Fix: rebuilt the evidence routes with flat workspaces and added keyboard-accessible province and member controls beside the deck.gl map.

### Pass 3 — Data and Visualization Integrity

- P1: long vote history rendered 1,059 cards and created a document roughly 275,000 px tall.
- P1: asset outliers obscured comparable lawmakers.
- P2: percentage axes and regional wording could imply invalid values or the wrong measure.
- Fix: added 20-record progressive disclosure, symmetric-log asset axes, a 0–100% vote domain, absence-rate wording, party-plus-intensity legends, and removed place-name overlays.

### Pass 4 — Runtime and Responsive QA

- P1: MapLibre added a second canvas, a 1 MB production chunk, external tile requests, and a worker error under production headless validation.
- P2: React Strict Mode duplicated the luma.gl canvas lifecycle in development and emitted a teardown diagnostic on route changes.
- Fix: kept deck.gl as a standalone controller/canvas, removed MapLibre and external raster tiles, removed the development-only double mount, and verified clean map-to-home transitions.

### Pass 5 — Jeju Legend Collision

- P1: the national-map legend was absolutely positioned over the lower map canvas and could obscure Jeju at narrower card widths.
- Fix: moved the legend into a dedicated grid row below the map and above the detail link instead of shifting the overlay to another corner.
- Post-fix evidence: the three Jeju constituency paths and the legend have an overlap area of `0 px²` at 1176 × 1280 and 390 × 844. The legend uses static positioning, begins below the map boundary, and introduces no horizontal overflow.
- Regression coverage: the responsive UI suite now asserts that the legend remains outside all rendered district geometry at mobile, tablet, and desktop widths.

### Pass 6 — Trend Toggle Responsive Layout

- P1: the trend title could end with an orphaned final Korean character, while the icon and toggle label were compressed into a tall multi-line button.
- Fix: gave the trend heading a shrink-safe text column, preserved Korean word boundaries, and made the toggle a non-shrinking, single-line control. The mobile target remains at least 44 px high.
- Post-fix evidence: `표로 보기` remains on one line, the title stays within two lines, button overflow is at most `1 px`, and the page has no horizontal overflow at 390 × 844, 768 × 1024, and 1440 × 900.
- Regression coverage: the UI suite measures label line count, title line count, button overflow, computed `white-space`, and mobile control height.

### Pass 7 — Scatter Tooltip Semantics

- P1: percentage tooltips exposed implementation-oriented labels (`가로`, `세로`) instead of explaining the represented measures.
- Fix: tooltip metric names now come from the active lens configuration and retain the matching formatter and unit.
- Post-fix evidence: the attendance tooltip reads `출석률 66.7% · 반대·기권 비중 50.0%`; the generic orientation labels are absent. Voting and asset lenses use their own configured metric names.
- Regression coverage: the desktop, tablet, and mobile UI suite hovers a real scatter point and asserts the semantic labels while rejecting `가로` and `세로`.

### Pass 8 — Initial Map Loading Gate

- Source loaded state: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/v3-map-final-1280x720.jpg`.
- Final loaded state: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/map-loading-gate-final-complete-1280x720.jpg`.
- Same-input comparison: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/map-loading-gate-source-vs-final.png`.
- Comparison viewport: 1280 × 720 at DPR 1.
- P1 discovered during the first browser comparison: a failed or incomplete static-map batch could set `isLoading` to false after only 9 of 17 provinces and expose a partial national map.
- Fix: the overview SVG now waits for every declared province entry, while the deck.gl route waits for every entry plus its first completed render frame. An incomplete terminal batch becomes an explicit error state instead of revealing a partial map.
- Loading evidence: the pending container reports `aria-busy="true"`, exposes semantic province progress, keeps the deck canvas at zero opacity and non-interactive, and removes the overlay only after the complete-data and first-frame conditions both hold.
- Final browser evidence: `17/17` provinces, `20,460` rendered cells, `aria-busy="false"`, zero loading overlays, one canvas at opacity `1`, and zero console errors.
- Regression coverage: a deterministic unit test holds the deck canvas hidden across partial data and an early `onAfterRender`, then reveals it only after full data and a subsequent render. Responsive UI tests assert the completed map state at mobile, tablet, and desktop sizes.

### Pass 9 — Asset Comparison Semantics

- Source visual truth: `/var/folders/3j/s53_zmzx43qb9v6xmsgxq9w80000gn/T/codex-clipboard-e5d3b31a-add0-4a43-b6ac-3786f5aa8587.png`.
- Final implementation: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/asset-comparison-bars-final-390x844.png`.
- Focused comparison: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/asset-comparison-source-vs-bars.png`.
- Source pixels: 620 × 756 at the user-captured narrow-browser density. Implementation viewport: 390 × 844 at DPR 1; the focused card is 370 × 338 pixels. The source was normalized to the implementation card height for the comparison input.
- P1: the asset view labeled a member-by-member ranking as `시간 흐름` and connected different lawmakers with trend lines, implying a temporal sequence that the data did not contain.
- Fix: changed the section context to `의원 비교`, renamed the title to `공개 재산 상위 의원 비교`, and replaced the line chart with a horizontal grouped bar chart for the top six disclosed totals. The chart preserves signed asset changes instead of converting decreases to absolute values.
- P2 found in the first bar pass: twelve members produced 36 narrow bars, the detached right-side values no longer represented an endpoint, and adjacent symmetric-log ticks overlapped.
- Fix: limited the focused comparison to six members, removed the temporal endpoint value rail for the asset lens, widened the plot, and applied a minimum tick gap. A visible note and accessible chart label disclose the symmetric-log scale used to keep the outlier and comparable amounts visible together.
- Post-fix evidence: 18 grouped bars, zero trend lines, zero detached endpoint values, no `시간 흐름` text in the asset card, no horizontal overflow at 390 px, and zero browser console errors. The visible numeric axis retains `0억` and the `1200억` upper reference without overlapping intermediate labels.
- Focused comparison was required because the semantic error and chart encoding were concentrated in one compact analytical card. Fonts, spacing, colors, icon treatment, and the table toggle remain consistent with the surrounding product system; there are no raster or custom-drawn assets in this data visualization.
- Regression coverage: the V2 observatory test asserts the new title, comparison kicker, symmetric-log disclosure, accessible bar-chart label, and absence of the old title.

### Pass 10 — Member Names as Detail Entry Points

- Source visual truth: `/var/folders/3j/s53_zmzx43qb9v6xmsgxq9w80000gn/T/codex-clipboard-3c20eb87-b349-454c-a288-51ea1766f152.png`.
- Final implementation: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/member-name-link-final.jpg`.
- Focused comparison: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/member-name-link-source-vs-final.png`.
- P1: the weekly observation and chart tooltips exposed real lawmaker names as inert text, forcing users to leave the evidence context and search for the same member again.
- Fix: introduced one semantic member-detail link with a canonical `#calendar?member=…` fallback and optional in-app navigation callback. The shared interaction now covers weekly observations, scatter and asset-comparison tooltips, asset tables, distribution tooltips, interactive deck.gl member overlays, and asset comparison panels and legends.
- Passive map hover labels no longer expose an unclickable member name; they report the member count until the user clicks the region and opens the interactive member overlay.
- Post-fix browser evidence: `이소희 의원 상세 보기` routed directly from the weekly observation to `#calendar?member=MRS4949T` and loaded the matching activity detail. The asset observation exposed `이주희 의원 상세 보기` with `#calendar?member=RBM5454A`.
- Accessibility: every new name entry point is a native link with a descriptive accessible name, visible underline, keyboard focus treatment, and a direct destination that still works without the JavaScript routing callback.
- Regression coverage: unit tests verify the canonical href and callback member ID, the V2 observation and asset-table routes, and the interactive deck.gl overlay. The mobile, tablet, and desktop UI suite confirms that every real scatter tooltip contains exactly one member-detail link.

### Pass 11 — Debt Context in Asset Views

- Source implementation: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/debt-assets-source.jpg`.
- Final asset lens: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/debt-assets-current.jpg`.
- Production asset lens: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/debt-assets-production.jpg`.
- Final member detail: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/debt-detail-current.jpg`.
- P1: the asset lens called the disclosed net amount `total assets`, omitted disclosed debt from the comparison, and used real-estate share as its secondary ranking signal. This made debt-heavy and debt-light lawmakers look equivalent when their disclosed net amounts were similar.
- Fix: renamed the net value to `net assets`, added disclosed debt to the top-lawmakers comparison, and changed the secondary evidence column and weekly observation to debt divided by estimated gross assets.
- Formula: `debt ratio = disclosed debt / (disclosed net assets + disclosed debt)`. Ratios above 100% remain visible because they indicate debt exceeding disclosed gross assets; a non-positive denominator is reported as unavailable rather than coerced to zero.
- Member detail now shows disclosed debt, estimated gross assets, debt ratio, and net assets in one focus block. Family-included and self-only scope selection updates the debt block together with the real-estate focus and history chart.
- Copy review: composition bars are now labeled as disclosed category shares and explicitly state that they are not a decomposition of net assets, because debt is a subtraction in the official total.
- Compatibility: the index field is optional, so the web client can read the previous published contract. Already-loaded member histories backfill debt without triggering a new all-member request burst; the next data build publishes the value for every member.
- Post-fix browser evidence: the current production-backed local view showed debt ratios for the top five net-asset records, including `1.1%`, `0.1%`, `19.4%`, `0.0%`, and `10.7%`. The selected member detail showed disclosed debt `14.21억원`, estimated gross assets `1,271.38억원`, debt ratio `1.1%`, and net assets `1,257.17억원`.
- Regression coverage: tests verify index fallbacks, a 25% fixture ratio, preserved 125% leverage, unavailable non-positive denominators, the debt series label, and the debt-ratio evidence column.

### Pass 12 — V2 Default and Legacy Removal

- P1: the root URL still selected a separate legacy application shell unless `?ui=v2` was present, while V2 evidence routes reused the legacy application component internally.
- Fix: made `V2App` the only root render target, extracted the shared evidence routes into `V2RouteContent`, and deleted the legacy entry gate, home, global navigation, leaderboard, and navigation stylesheet.
- Compatibility: `/`, `?ui=v1`, and `?ui=v2` now render the same V2 home. Existing hash routes for member activity, distributions, maps, votes, and trends continue to resolve inside the V2 shell.
- Bundle evidence: the main JavaScript bundle decreased from approximately `1,239.19 kB` to `1,219.83 kB`, and the main CSS bundle decreased from `181.79 kB` to `179.20 kB`.
- Browser evidence: the root URL, both historical UI query variants, and the votes route rendered the V2 global navigation and `국회 움직임 탐색기` without any legacy home or navigation element.
- Regression coverage: the responsive UI suite enters from the query-free root, follows a V2 ranking directly to member detail, and verifies that `?ui=v1` cannot reactivate a legacy shell.

### Pass 13 — Progressive Party Color and Map Legend

- Source visual truth: `/var/folders/3j/s53_zmzx43qb9v6xmsgxq9w80000gn/T/codex-clipboard-86a143ff-d68d-4fc5-af9f-176c8656e878.png`.
- Legend brief: `/var/folders/3j/s53_zmzx43qb9v6xmsgxq9w80000gn/T/codex-clipboard-e723226f-ab63-4149-bafb-820b1a2e8a78.png`.
- P1: the shared visualization palette encoded the Progressive Party with a crimson close to the People Power Party red. The distribution view also assigned colors by party order and used red as its unknown-party fallback.
- Fix: changed the Progressive Party visualization color to a chart-safe magenta derived from its secondary pink, centralized distribution colors on the shared party palette, and changed unknown parties to neutral gray.
- Legend simplification: the map legend no longer renders one intensity stripe per party. It states that hue separates parties, shows one neutral light-to-dark intensity example, and keeps a separate missing-data swatch.
- Browser evidence: the production-backed local asset view rendered the Progressive Party as `rgb(192, 42, 138)` and the People Power Party as `rgb(220, 50, 32)`. All eight parties remained visible in the scatter legend with zero horizontal overflow.
- Responsive evidence: at 390 px, the simplified map legend measured approximately 144 px wide, contained zero party ramps and one intensity example, and introduced no document or card overflow.
- Regression coverage: focused tests verify the Progressive Party and unknown-party colors, the simplified legend semantics, and the absence of per-party ramps.

### Pass 14 — Selected Region Member Directory

- Source visual truth: `/var/folders/3j/s53_zmzx43qb9v6xmsgxq9w80000gn/T/codex-clipboard-552fd2b8-0e36-49f7-8b10-24c7eb9ab694.png`.
- P1: the selected-region panel repeated the same geographic visualization as the national map, while the actual regional lawmakers were reduced to a horizontally scrolling row of names.
- Fix: removed the secondary deck.gl map and replaced it with a semantic member directory. Each member card includes party, constituency, absence rate, negative/abstain rate, disclosed real estate, and disclosed net assets.
- Navigation: every card is one native link with a canonical member-detail destination, descriptive accessible name, keyboard focus state, and the existing in-app navigation callback.
- Responsive evidence: desktop keeps the directory in the 342 px comparison rail; tablet expands to a two-column directory; mobile uses one column with no horizontal overflow.
- Rendering evidence: the selected-region state now has one deck.gl canvas total, creates no `h3-panel-*` layer, and preserves the national map as the geographic selection surface.
- Regression coverage: component tests verify exact fixture metrics, the canonical member href and callback, the absence of the secondary deck, and legacy district-to-province promotion. The browser suite validates the directory at mobile, tablet, and desktop sizes.

### Pass 15 — Stable National Map Height

- Source visual truth: `/var/folders/3j/s53_zmzx43qb9v6xmsgxq9w80000gn/T/codex-clipboard-db790067-86dc-4abf-bd32-7d174961645a.png`.
- P1: selecting a province expanded the regional directory to its full content height. CSS Grid stretched the national map to the same row height, leaving the centered Korea geometry far below the visible viewport and making the map appear empty.
- Measured baseline: selecting Chungbuk produced a 1,750 px workspace and national section, a 1,667 px map container, and a 1,511 px unbounded directory.
- Fix: constrained the desktop directory to a 410 px internal scroll region while preserving natural document flow below the single-column breakpoint.
- Regression coverage: the desktop browser suite injects 16 additional member cards and verifies that the list overflows internally while both the national and detail panels remain at or below 720 px.

### Final Comparison

- No actionable P0, P1, or P2 mismatch remains.
- Accepted difference: the source mock uses synthetic risk colors; the implementation preserves official party identity and modulates intensity by the selected real metric.
- Accepted difference: the source mock contains illustrative change counts; the implementation derives rankings, counts, chart domains, and observations from current product data.
- Accepted difference: real constituency geometry replaces the source illustration while preserving the selected workspace hierarchy.

## Interaction and Console Verification

- Attendance, voting tendency, and asset lenses switch with keyboard and pointer input.
- Search and ranking routes open member activity without requiring a UI query gate.
- Map metric buttons, province shortcuts, district selection, H3 hover/click, member shortcuts, and reset controls work.
- Vote filters and search reset pagination; the load-more action progressively reveals remaining records.
- Trend windows and table mode stay aligned.
- The responsive trend toggle remains a single-line 44 px mobile control, and scatter hover content names the represented metrics.
- A fresh standalone deck.gl map-to-home transition produced zero browser errors.
- The UI suite recorded no unexpected console errors, page errors, or local request failures. The test fixture intentionally exercises the existing precomputed-hexmap 404 fallback before computing its two fixture provinces.

## Automated Verification

- `npm test`: 37 files, 150 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run test:ui`: 12 desktop/tablet/mobile scenarios passed, including tooltip member-link coverage across all six rebuilt V2 routes.
- `npm test -- tests/web/v2-observatory.test.tsx`: 6 tests passed.
- Jeju overlap geometry: passed at 1176 × 1280 and 390 × 844.
- Changed-file Prettier check: passed.
- `git diff --check`: passed.
- `.github/workflows`: unchanged.

### Pass 16 — Regional Evidence Ledger

- Source visual truth:
  - `/var/folders/3j/s53_zmzx43qb9v6xmsgxq9w80000gn/T/codex-clipboard-664ebb6f-8ce5-4655-896a-6b44bfb6709a.png` at 1487 × 1058.
  - `/var/folders/3j/s53_zmzx43qb9v6xmsgxq9w80000gn/T/codex-clipboard-00eaea2a-f5cc-4ddc-b79b-a4e480d17f2f.png` at 1487 × 1058.
- Final desktop evidence:
  - `/Users/gun9/Developer/lawmaker-monitor/.artifacts/ui/desktop/v2-map.png` at 1440 × 1123.
  - `/Users/gun9/Developer/lawmaker-monitor/.artifacts/ui/desktop/v2-map-summary.png` at 1440 × 1089.
- Side-by-side comparisons:
  - `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/reference-vs-implementation.png`.
  - `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/reference-vs-summary.png`.
- P1: the previous cartogram made comparison depend on spatial inference and color intensity, while the reference required a direct region → metric → lawmaker → evidence path.
- Fix: replaced the detailed map route with a regional evidence ledger. The member view now combines all available province tabs, four evidence metrics, constituency-grouped member cards, official portraits, metric bars, search, selection state, and a persistent evidence panel with a canonical member-detail link.
- Nationwide comparison: added a dedicated summary view with explicit square, circle, diamond, and triangle severity markers, metric values, seat counts, national averages, ranks, and a selected-region evidence panel. The live data rendered all 17 provinces; the deterministic UI fixture intentionally contains Seoul and Busan only.
- State integrity: selecting a province from the summary view exposed a route synchronization race that restored the previous province. The route-to-state effect now runs only when route inputs change, and the regression scenario verifies that the selected province persists.
- Accessibility and interaction: metric controls are keyboard-navigable tabs, all region and member selections are native buttons, the detail destination is a native link, and severity is never encoded by color alone.
- Responsive evidence: the complete route passed at 390 × 844, 768 × 1024, and 1440 × 900. The production-backed local preview at 576 px rendered 18 Busan member cards with zero horizontal overflow. Browser error and warning logs were empty.
- Accepted difference: the application preserves its established global navigation and current data provenance rather than copying the reference brand shell or synthetic values.
- Accepted difference: the nationwide summary uses an ordered administrative matrix instead of a decorative geographic silhouette; it preserves the reference's explicit severity semantics and direct drill-down while avoiding an implied geographic precision that the summary does not need.

## Pass 16 Verification

- `npm test`: 43 files, 188 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed.
- `npm run test:ui`: 12 responsive scenarios passed; member and nationwide-summary screenshots are included in the manifest.
- Browser console: zero warnings and zero errors.
- Horizontal overflow: zero in the live responsive preview.

### Pass 17 — Accountability Watch Queue and Member Share Cards

- Source target: `/tmp/watch-share-visuals.fGTEbp/home.png` at 512 × 505.
- Final implementation: `/Users/gun9/Developer/lawmaker-monitor/artifacts/watch-queue-home-final-1440x900.jpg` at 1440 × 900 and `/Users/gun9/Developer/lawmaker-monitor/artifacts/watch-queue-home-final-390x844.jpg` at 390 × 844.
- Combined comparison: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa-home-comparison.jpg`. The source was normalized to 900 px high and centered in a 1440 × 900 paper canvas before horizontal composition with the implementation.
- P1 found on the first comparison: the implementation retained three dashboard summary cards instead of the source's filter rail, chronological evidence feed, and issue briefing rail.
- Fix: replaced the dashboard introduction with the three-rail `WatchQueueSnapshot`, using real vote-change, absence, and bill-outcome records. Every record identifies the member, party, constituency or representation state, numerator/denominator, ingestion date, interpretation rationale, and member-detail action.
- P1 found in semantic review: the feed claimed ingestion-time ordering while using magnitude ordering, reused vote labels for bill outcomes, and promised a no-action signal without rendering one.
- Fix: unified records by source ingestion time, added a documented absence signal, and assigned record-specific metric and action labels. Missing, loading, failure, and measured zero states are no longer conflated.
- P1 found in responsive review: the first mobile viewport ended before the first evidence record because observation metadata expanded the filter rail.
- Fix: retained the accessible filter-first DOM order, converted state filters to compact chips, and omitted duplicate scope metadata on the mobile breakpoint. The first evidence record now appears in the initial mobile viewport.
- Member portrait treatment: the shared SVG filter and generated share cards use grayscale, contrast shaping, paper grain, and halftone overlays. Party color is not used as a portrait or card theme.
- Member share evidence: 298 fragment-free canonical pages and 298 unique 1200 × 630 PNG cards were generated. The representative card `/Users/gun9/Developer/lawmaker-monitor/apps/web/dist/member-cards/T2T8225E.png` contains a real portrait, party, representation status, denominated performance facts, latest meeting-minutes agenda, and ingestion date.
- Sponsorship safety: the product publishes and renders only official NEC committee registration and online donation routes. Direct-deposit bank, account-number, account-holder, and copy controls are excluded from the public export, member detail, and external share cards. Missing data links to the official NEC donation center; load failure is a separate retryable state.
- Share cache integrity: the OG image version includes both the data snapshot and meeting-summary generation metadata. Minute-summary deployments read the data repository's raw main branch rather than waiting for its Pages cache.
- Interaction verification: all three state filters update a dedicated result-count live region; member evidence links route to the accountability ledger; share link copy and Web Share fallback expose a fragment-free canonical URL; verified-only clipboard behavior is covered by regression tests.
- Console and responsive verification: the 12-scenario UI suite passed across 390 × 844, 768 × 1024, and 1440 × 900 with no unexpected console errors, request failures, or horizontal overflow.
- Accepted boundary: the production UI exposes the official NEC verification and online donation paths without publishing or copying direct-deposit account details.

## Pass 17 Verification

- `npm test`: 50 files, 225 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run format:check`: passed.
- `npm run build`: passed; 298 canonical member pages and 298 PNG cards generated.
- `npm run test:ui`: 12 responsive scenarios passed across all six product routes.
- `git diff --check`: passed.
- Final browser measurement: 1440 × 900, zero horizontal overflow, five visible queue records, and three active evidence filters.

### Pass 18 — Ink and Oxblood Theme with Option-1 Share Card

- Selected visual truth: `/Users/gun9/.codex/generated_images/019f915e-92a0-7650-bf31-0ac7378fa4e6/call_43weW8KraNkVAAMPJYXjhruw.png` at 1731 × 909.
- Final generated card: `/Users/gun9/Developer/lawmaker-monitor/apps/web/dist/member-cards/T2T8225E.png` at 1200 × 630.
- Same-input comparison: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/member-card-option-1-source-vs-final.png`. The source was normalized to 1200 × 630 and placed beside the implementation before visual judgment.
- Thumbnail evidence: `/Users/gun9/Developer/lawmaker-monitor/artifacts/design-qa/member-card-option-1-thumbnail.png` at 300 × 158.
- P1: the prior card used a civic-teal field, reduced the real portrait to a secondary panel, and expressed evidence as three equal bullets that lost hierarchy at social-feed size.
- Fix: implemented the selected option-1 layout with a real official portrait occupying the left two-fifths, grayscale contrast and halftone treatment, a large member name, and exactly two dominant performance blocks. Missing evidence is not synthesized; the generator renders only valid highlights.
- First comparison finding: the portrait and metric values were visually weaker than the selected target. The final pass enlarges the portrait crop and uses oxblood for the two dominant values while keeping their denominators and contexts in ink and ochre.
- Thumbnail result: the portrait, member name, absence count, and lead-proposal count remain identifiable at 300 × 158. Secondary denominators remain visible without competing with the primary values.
- Theme system: the global token layer, final Watch Queue presentation layer, regional evidence ledger, national-map sequential scale, activity comparison colors, bill charts, asset palette, and legacy route fallbacks now use newsprint, ink, oxblood, ochre, and warm slate.
- Regional percentage encoding: low, normal, caution, and high states use warm slate, ink, ochre, and oxblood respectively. Each bar retains its direct percentage label, and the focused state retains the explicit severity label, so meaning is not color-only.
- Teal audit: the repository scan found no remaining civic-teal variables or known teal palette values, and a hue scan found no saturated 160°–190° color literal in active web source.
- Browser boundary: the in-app browser session did not expose an attachable tab during this pass. Visual fidelity was therefore verified on the generated social-card artifact and its normalized comparison; route behavior and palette changes were verified through component tests, build output, type checking, linting, and source-level color audits.

## Pass 18 Verification

- `npm test`: 50 files, 225 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed; 298 canonical member pages and 298 PNG cards generated.
- Selected-card comparison at 1200 × 630: passed.
- Social thumbnail check at 300 × 158: passed.
- Saturated civic-teal hue scan: zero matches.
- `git diff --check`: passed.
- `.github/workflows`: unchanged.

final result: passed

### Pass 19 — Plenary Chamber Vote Board

- Official source truth: `/Users/gun9/Developer/lawmaker-monitor/artifacts/official-plenary-seat-chart-2024-12-04.jpg` at 1396 × 986. The chart is extracted from the 22nd National Assembly, 418th session, 15th plenary meeting record and is marked as based on September 19, 2024.
- Final local implementation: `/Users/gun9/Developer/lawmaker-monitor/artifacts/plenary-chamber-component.png` at 1214 × 923.
- Same-input comparison: `/Users/gun9/Developer/lawmaker-monitor/artifacts/plenary-chamber-reference-comparison.png` at 2428 × 720.
- P1: the official chart contains historical named seat assignments, while the current product export does not contain a verified current member-to-seat mapping or individual affirmative-vote list.
- Fix: the implementation adopts only the official fan-shaped 300-seat geometry. It explicitly labels member positions as pending current assignment verification, renders only known no, abstain, and absence records as verified outcomes, and separates unlinked affirmative selections from vacant seats.
- Data fidelity: the selected live vote displays the published counts of 181 affirmative, 0 no, 6 abstentions, and 112 absences. The detail panel reports linked-list coverage as 0/0, 6/6, and 107/112 instead of implying complete coverage.
- Interaction: the vote selector switches among the twelve latest recorded votes, outcome filters visually mute unrelated seats, and selecting a known seat exposes the member identity, party, constituency or proportional status, outcome explanation, and canonical member record link.
- Accessibility: all 300 seats are native buttons with descriptive accessible names; filters use `aria-pressed`; the detail panel is a polite live region; outcome states use shape, outline, and color rather than color alone.
- Responsive evidence: the component has zero horizontal overflow at 390 × 844 and remains keyboard-operable. Browser console verification produced zero warnings and zero errors.
- Accepted boundary: party-sorted provisional positions are an interaction scaffold, not a claim about the current official assigned seat. Production adoption requires a current official seating-chart ingestion and verification step.

## Pass 19 Verification

- `npm test -- tests/web/plenary-seats.test.tsx`: 2 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build --workspace @lawmaker-monitor/web`: passed; 298 canonical member share pages generated.
- Browser interaction: vote change, outcome filtering, member-seat selection, and canonical member navigation passed.
- Browser console: zero warnings and zero errors.
- Horizontal overflow: zero at 390 × 844.
- `.github/workflows`: unchanged.

final result: passed

### Pass 20 — Chair-Centered Member Portrait Vote Board

- Official geometry reference: `/Users/gun9/Developer/lawmaker-monitor/artifacts/official-plenary-seat-chart-2024-12-04.jpg` at 1396 × 986.
- Final desktop evidence: `/Users/gun9/Developer/lawmaker-monitor/artifacts/plenary-chamber-member-portraits.png` at 1214 × 1275.
- Final mobile evidence: `/Users/gun9/Developer/lawmaker-monitor/artifacts/plenary-chamber-mobile.png` at 390 × 844.
- Same-input comparison: `/Users/gun9/Developer/lawmaker-monitor/artifacts/plenary-chamber-reference-comparison.png` at 2428 × 1276.
- P1: the first prototype did not preserve affirmative member identities, so an affirmative tally could not be traced to individual lawmakers.
- Fix: the latest twelve roll calls now publish lean individual `yes`, `no`, `abstain`, and verified `absent` records. Legacy source identifiers fall back to normalized names without converting unknown members into inferred outcomes.
- Portrait layout: every occupied seat renders the official member portrait in the product-wide grayscale halftone treatment. The 300-seat fan is oriented around a visible chair position, and portrait selection opens the member's party, constituency or proportional status, recorded outcome, and canonical accountability record.
- Affirmative interaction: selecting the affirmative filter left 171 explicitly linked portraits visible for the local compatibility fixture. The selected affirmative member detail reported the official result and opened the correct member record.
- Data boundary: the live compatibility fixture links 171/181 affirmative, 0/0 no, 6/6 abstention, and 107/112 absence identities. Missing identities remain visibly unlinked. A normal post-change ingest rebuild will read the complete individual records already collected from the National Assembly roll-call endpoint.
- Responsive evidence: the page remained 390 px wide with zero document overflow. The 980 px chamber canvas stays inside its own 346 px horizontal viewport and opens centered at `scrollLeft = 317`.
- Browser console: zero warnings and zero errors.
- Portrait mask correction: the shared SVG newsprint filter and the global button background both exposed rectangular regions at the 24.8 px seat size. The chamber now paints portraits as masked background layers with CSS grayscale and contrast, applies an explicit radial mask, circular clip, hidden overflow, and border-box sizing, and forces the seat button canvas to stay transparent. The magnified evidence is `/Users/gun9/Developer/lawmaker-monitor/artifacts/plenary-chamber-mask-zoom.png`.
- Outcome semantics: affirmative remains a lime circle, opposition uses a purple diamond outside the circular portrait, abstention keeps its dashed ring, and absence keeps the intentionally faded treatment. Opposition is therefore distinguishable by shape without depending on color.
- Accepted boundary: the current party-sorted portrait positions preserve the official chamber orientation but are not represented as verified current assigned seats. The interface keeps the provisional-status badge until a current official member-to-seat source is ingested.

## Pass 20 Verification

- `npm test`: 58 files, 265 tests passed.
- `npm test -- tests/ingest/pipeline.test.ts tests/web/plenary-seats.test.tsx`: 19 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build --workspace @lawmaker-monitor/web`: passed; 298 canonical member share pages generated.
- Browser interaction: affirmative filtering, member portrait selection, result detail, and canonical member navigation passed.
- Browser responsive check: zero document overflow at 390 × 844; chamber-only horizontal scrolling passed.
- `git diff --check`: passed.
- `.github/workflows`: unchanged.

final result: passed

### Pass 21 — Balanced Seat Density and Vote-Record Seat Maps

- User feedback source: `/var/folders/3j/s53_zmzx43qb9v6xmsgxq9w80000gn/T/codex-clipboard-18dc5a2c-2e7c-4f28-a7d1-01beaa748a2d.png` at 2830 × 1272.
- Revised desktop implementation: `/Users/gun9/Developer/lawmaker-monitor/artifacts/plenary-chamber-density-adjusted.png` at 1440 × 1000 from the local `#votes` route.
- Same-input comparison: `/Users/gun9/Developer/lawmaker-monitor/artifacts/plenary-chamber-density-comparison.png` at 3298 × 900. Both sides were normalized to 900 px high before horizontal composition.
- Vote-record seating map: `/Users/gun9/Developer/lawmaker-monitor/artifacts/vote-record-seat-map.png` at 1440 × 1000.
- Responsive evidence: `/Users/gun9/Developer/lawmaker-monitor/artifacts/vote-record-seat-map-mobile.png` at 390 × 844.
- P2 found in the source feedback: the outermost row placed 48 portraits across a 130-degree fan, leaving the perimeter almost edge-to-edge and visually heavier than the inner rows.
- Fix: redistributed all 300 seats across 11 rows with 37 seats on the outermost row and widened the fan to 144 degrees. The resulting outer-center pitch increased from approximately 25 px to 33 px at the base 980 px canvas while preserving the 300-seat total and chair-centered orientation.
- Information controls: the main chamber now provides party selection and member search by name, party, or constituency. The live result count reflects the intersection of the outcome, party, and query filters without changing the underlying official tally.
- Vote-record redesign: the former no/abstain/absence roster list is replaced by an on-demand seating map. It includes affirmative choices, exposes linked-name coverage for every outcome, supports party and member filtering, and renders only when its evidence disclosure is open.
- Data boundary: absent or affirmative identities that are not present in the published member list remain visually unlinked; the map does not infer missing choices.
- Typography: the existing newspaper display hierarchy and compact evidence labels are preserved.
- Spacing and layout: outer-row density is reduced, the fan has more lateral breathing room, and both filter rails collapse to one column on narrow screens.
- Colors and tokens: active controls use the saved lemon-lime product accent; party colors are not used as generic UI emphasis.
- Image quality: official portraits retain the grayscale circular mask with no rectangular photo edge. Opposition keeps the distinct purple diamond, abstention the dashed ring, and absence the faded treatment.
- Copy: “공개 선택 배치도” and the linked-name counts clarify that the view represents public individual records rather than an inferred full roster.
- Browser interactions verified: party filter reduced the chamber to four Progressive Party members, the query `박은정` returned one proportional member, reset restored the complete map, and opening one evidence record rendered exactly one 300-seat record map with an affirmative tab.
- Responsive measurement: the document remained 390 px wide at a 390 × 844 viewport. The 760 px compact chamber canvas stays inside its own 284 px horizontal viewport.
- Runtime check: no Vite error overlay or alert boundary was present. Desktop document width matched the 1440 px viewport.
- Focused-region comparison was required because the task concerns seat pitch and portrait masking. The normalized side-by-side evidence shows a visibly sparser perimeter while retaining the same portrait scale and semantic outcome shapes.
- Remaining P3: the compact mobile map still requires horizontal exploration by design; a future minimap could improve orientation without shrinking portraits below a recognizable size.

## Pass 21 Verification

- `npm test`: 58 files, 267 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- Targeted Prettier check for all changed chamber and vote-record files: passed.
- Repository-wide `npm run format:check`: blocked only by eight pre-existing, unrelated files; no file in this change set was listed.
- `npm run build --workspace @lawmaker-monitor/web`: passed with 298 generated member share pages.
- `git diff --check`: passed.
- Browser desktop and mobile interaction checks: passed.

final result: passed

### Pass 22 — Unified Plenary Vote Record Explorer

- Source visual truth: the existing “본회의장 표결판” rendered in `/Users/gun9/Developer/lawmaker-monitor/artifacts/plenary-board-unified-comparison.png`.
- Final desktop implementation: `/Users/gun9/Developer/lawmaker-monitor/artifacts/plenary-archive-board-final.png` at a 1280 × 720 CSS viewport and 1× density.
- Final mobile implementation: `/Users/gun9/Developer/lawmaker-monitor/artifacts/plenary-archive-board-mobile.png` at a 390 × 844 CSS viewport and 1× density.
- Focused outcome evidence: `/Users/gun9/Developer/lawmaker-monitor/artifacts/plenary-chamber-lime-yes-borders.png` at a 1280 × 720 CSS viewport.
- Same-input comparison: `/Users/gun9/Developer/lawmaker-monitor/artifacts/plenary-board-unified-comparison.png` contains the source chamber and the archive chamber in the same rendered page and data state. No density normalization was required.
- P1 found: the prior lower explorer used a vertical sequence of independent vote cards, so its search, result-list, roster, and evidence interactions did not match the chamber-first model introduced above it.
- Fix: replaced the lower timeline with an archive mode of the same chamber component. The unified flow is now record search → record condition → bill selection → outcome filter → party/member filter → seat selection → official evidence.
- Preservation: named and recorded public votes remain searchable; secret votes remain excluded from the public seat explorer. Official source links and the meeting-minutes opinion panel remain attached to the selected vote.
- P2 found during responsive comparison: the three-column archive toolbar would not fit a narrow viewport.
- Fix: the archive search, record-condition filters, and count stack into one column at tablet width; record-condition buttons use two columns on mobile. The 390 px document has zero horizontal overflow.
- Typography: the archive reuses the newspaper display title, compact evidence labels, and serif bill hierarchy of the source chamber.
- Spacing and layout: both boards use the same header, bill selector, outcome controls, member filters, bill summary, fan-shaped seat canvas, detail panel, and source footer. The archive adds only a preceding record-search rail.
- Colors and tokens: controls retain the product lemon-lime accent. Affirmative member portrait borders now use the bright lemon-lime token directly; opposition remains a purple diamond, abstention remains a dashed ring, and absence remains faded.
- Image quality: official grayscale member portraits preserve their circular masks. The focused screenshot confirms that the lemon-lime affirmative ring does not expose rectangular image edges.
- Copy: the archive title and description explain that the same chamber is used to compare selected outcomes and meeting-minutes evidence.
- Primary interactions tested in the browser: archive search reduced 1,057 records to one matching bill; the absence filter updated the selected-record set; selecting seat 1 exposed the member, party, district, and recorded outcome.
- Console/runtime evidence: no Vite error overlay appeared. Automated component tests and the production build completed without application errors.
- Focused-region comparison was required because the final user adjustment concerns the affirmative portrait border and its separation from other outcome shapes.
- Remaining P3: the 980 px chamber canvas intentionally scrolls horizontally on mobile to preserve portrait recognition.

## Pass 22 Verification

- `npm test`: 58 files, 267 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build --workspace @lawmaker-monitor/web`: passed; 298 canonical member share pages generated.
- `git diff --check`: passed.
- Browser desktop and mobile layout checks: passed.
- Browser archive search, record filtering, and seat-detail interaction checks: passed.

final result: passed
