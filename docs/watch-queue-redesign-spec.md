# Accountability Watch Queue Redesign Specification

## 1. Product Direction

The entire product is reframed as an evidence-first accountability watch queue.
The service does not assign a moral score to lawmakers. It helps citizens identify
newly collected public records, understand why those records matter, compare them
with an explicit baseline, and open the official source.

The primary change clock is the ingestion timestamp. The official event timestamp
is always shown separately.

## 2. Product-wide Information Architecture

| Current route     | Redesigned route             | Primary user question                                                                                 |
| ----------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| Home observatory  | Watch Queue                  | What new evidence was collected and why does it require attention?                                    |
| Vote timeline     | Issues and Votes             | On this issue, what did lawmakers say, how did they vote, and what happened afterward?                |
| Distribution      | Member Explorer              | Which lawmakers match an evidence-backed behavior or missing-action condition?                        |
| Regional map      | Regional Accountability      | What changed among lawmakers representing this region?                                                |
| Trends            | Change Ledger                | Which new records caused the visible change, and is it behavior change or source latency?             |
| Activity calendar | Member Accountability Ledger | What has this lawmaker said, voted for, followed through on, or not done when an opportunity existed? |

The global navigation order is:

1. Watch Queue
2. Issues and Votes
3. Members
4. Regions
5. Change Ledger

Universal member search, latest ingestion time, source guidance, and share controls
remain visible in the global header.

## 3. Evidence Semantics

### 3.1 Evidence states

- **Contribution signal**: a verified public record demonstrates a relevant action,
  explanation, follow-up, participation, or outcome.
- **Caution signal**: a verified public record creates a material inconsistency,
  unusual change, or scrutiny need.
- **Documented no-action**: no action is recorded despite a defined and documented
  opportunity. The opportunity denominator is mandatory.
- **Pending judgment**: the available record is incomplete, not comparable, or
  insufficient to support another state.

No aggregate good/bad score is allowed.

### 3.2 Time fields

Every evidence record shows time fields in this order:

1. Official event time
2. Ingestion time
3. Source latency, when relevant

The default queue order is ingestion time descending. Users may switch to official
event time ordering.

### 3.3 Required evidence fields

Every evidence record must expose:

- Member portrait and name
- Party
- Constituency or proportional-representation status
- Record type
- Evidence-state marker with icon and text
- Headline
- Classification rationale
- Official event time
- Ingestion time
- Comparison baseline
- Observation period
- Coverage numerator and denominator
- Official source
- Evidence drawer trigger

### 3.4 Evidence transition model

Every evidence record that changes a visible observation state supports a
Before–After Docket:

1. **Previous state**: the latest comparable state before the new ingestion.
2. **Newly collected evidence**: the exact public record that triggered the
   change.
3. **Current interpretation**: the new evidence state and a plain-language
   rationale.

The transition must disclose whether the records are directly comparable. When a
previous comparable record does not exist, the UI shows "no comparable previous
record" and does not imply a change.

Each transition includes:

- Previous evidence record ID
- Current evidence record ID
- Previous and current state
- State-change rationale
- Comparable-record criteria
- Baseline type
- Official event time
- Ingestion time
- Source latency
- Source version and correction state

### 3.5 Issue comparison model

Every evidence record may belong to one or more normalized issues. An issue is a
public-policy question that can connect bills, meeting-minutes statements, formal
opinions, votes, committee responsibilities, and follow-up actions.

The Issue Comparison view uses the same comparison columns for every member:

- Latest official statement
- Latest formal opinion
- Bill participation
- Vote
- Follow-up action
- Documented no-action opportunity
- Pending or unavailable evidence

Position-change labels are allowed only when two comparable explicit public
records exist. AI summaries may help users navigate the source but cannot create a
position that is not supported by the official record.

## 4. Shared Component System

### 4.1 Global header

A flat paper-like header with a single hairline bottom border. The active route uses
a thin teal underline. Party colors never appear in the navigation.

### 4.2 Context band

Each route begins with:

- Editorial route title
- One-sentence purpose
- Assembly and observation period
- Latest ingestion time
- Source coverage

### 4.3 Evidence record row

The record row is the dominant reusable component. It has a 4px semantic left
border and three internal zones:

1. Identity and source metadata
2. Evidence headline, excerpt, and classification rationale
3. Time, baseline, denominator, and official source

### 4.4 Evidence drawer

The right-side drawer uses the same sequence on every route:

1. Previous state
2. Newly collected evidence
3. Current interpretation
4. Comparison basis
5. Coverage and denominator
6. Official source
7. Fairness caveat

### 4.5 Evidence-state filter

Evidence states use an icon, Korean label, and color together. Color-only encoding
is prohibited.

### 4.6 Loading and incomplete-data states

- Show a composed skeleton until a visualization and its labels are ready.
- Keep the final visualization hidden until rendering is complete.
- Distinguish source failure, no published data, zero measured value, and pending
  judgment.
- Never render zero as a substitute for missing data.

### 4.7 Before–After Docket

The docket is available from every evidence record, chart annotation, member row,
map selection, and issue comparison cell.

It has three fixed columns or stacked mobile sections:

1. Previous state
2. Newly collected evidence
3. Current interpretation

The component includes a source-chain footer, comparison criteria, correction
history, and a direct official-source link. It never hides a missing or
non-comparable previous state.

### 4.8 Issue Comparison Board

The board supports:

- Issue search and normalized issue selection
- Assembly, committee, region, party, and representation filters
- Statement, opinion, bill, vote, follow-up, and no-action columns
- Ingestion-period selection
- Comparable-record-only position-change view
- Member and issue sorting without moral ranking
- Evidence drawer for every populated cell
- Explicit "no published record" and "insufficient coverage" states

### 4.9 Cross-screen navigation

The primary evidence path is:

`Watch Queue → Issue Comparison → Member Ledger → Official Source`

The reverse path remains available through breadcrumbs and preserved route state.
URLs preserve the selected issue, member, period, evidence type, evidence state,
and ordering mode so an evidence view can be shared without losing context.

### 4.10 Official sponsorship account

Every member identity surface may expose an official sponsorship account module.
It is displayed only when the account has a current, publicly verifiable source.

The module shows:

- Bank name
- Full published account number
- Account holder
- Public-source label and link
- Last verified date
- `계좌번호 복사` action
- `계좌 정보 전체 복사` action

The clipboard confirmation uses a short live-region message such as
`계좌번호가 복사되었습니다`. Copying the account number writes digits and required
separators only. Copying the full account writes bank, account number, account
holder, member name, and the official source URL in a readable text block.

The product does not collect donations, store payment information, or imply that
the account is endorsed by the service. A missing, expired, conflicting, or
unverified account is shown as an explicit source state and cannot be copied.

### 4.11 Member performance share card

Every member identity surface provides `의원 실적 카드 공유`. The action opens a
preview before invoking the platform share sheet and also provides `링크 복사`.

The external preview uses a member-specific canonical URL and Open Graph image.
The card contains:

- Grayscale halftone portrait
- Member name
- Party and constituency or proportional-representation status
- Assembly and observation period
- Up to three evidence-backed activity facts with denominators
- Most recent issue-linked evidence headline
- Latest ingestion date
- Product identity and a concise public-record caveat

The share card never shows a composite moral score, an unsupported ranking, a
party-color theme, or a value whose source coverage is insufficient. When fewer
than three comparable facts exist, the card reduces its fact count instead of
substituting zero or inferred performance.

## 5. Screen Specifications

### 5.1 Watch Queue

Use a three-rail composition:

- Left: type, state, committee, region, and ingestion-period filters
- Center: newest-first evidence queue
- Right: current issues, coverage changes, and saved watch conditions

Former home dashboard elements become filtered queue entry points:

- Regional absence change
- Participation trend
- Bill proposal and outcome change
- Member distribution

Every queue row exposes two immediate actions:

- Open the Before–After Docket
- Compare this record within its issue

Users may group the queue by ingestion date, issue, member, committee, or region
without changing the underlying evidence semantics.

### 5.2 Member Accountability Ledger

Use a persistent identity rail and chronological evidence ledger. Integrate:

- Meeting-minutes statement summaries
- Issue positions
- Vote records
- Attendance and absence opportunities
- Bill sponsorship and outcomes
- Committee relevance
- Asset and debt disclosure history
- Official source documents

The page emphasizes state change and source chronology rather than a calendar-first
layout.

The ledger provides:

- A transition timeline that opens each Before–After Docket
- An issue matrix summarizing the member's latest explicit position, vote, and
  follow-up action
- A position-history view that uses comparable records only
- Links from every issue cell to the full Issue Comparison Board
- A sourced sponsorship-account block in the persistent identity rail
- A member performance share-card preview with link copy and system sharing

### 5.3 Issues and Votes

Organize the page around a selected issue or bill. Compare:

- Latest official statement
- Formal opinion
- Vote
- Bill participation
- Follow-up action
- Documented no-action opportunity

Position changes are displayed only when two comparable official records exist.

The Issue Comparison Board becomes the primary surface. The vote timeline remains
available as one evidence layer inside the issue rather than an isolated list.
Users can compare all relevant lawmakers or narrow the board to committee members,
regional representatives, bill sponsors, or selected members.

Each member identity cell provides a member-ledger link and a compact share action.
The account number remains inside the member identity drawer and is not repeated
across the comparison matrix.

### 5.4 Member Explorer

Use a searchable evidence table as the primary surface. A distribution plot may be
used only as a secondary navigation aid.

The table includes:

- Member
- Affiliation and representation type
- Latest change
- Evidence-state counts with denominators
- Vote participation
- Issue relevance
- Data coverage

Selecting two members opens a shared comparison drawer.

Each result row includes the latest evidence transition and most relevant active
issue. Comparison mode provides both a member-by-member evidence ledger and an
issue-by-issue matrix.

The row action menu includes `의원 실적 카드 공유`. Selecting a single member opens
the identity drawer with the verified sponsorship-account module.

### 5.5 Regional Accountability

Use an equal-area electoral cartogram as a navigation overview. The member ledger
is the primary evidence surface.

Cartogram severity uses:

- Neutral-to-teal intensity
- Explicit level label
- Shape or symbol
- Actual value
- National percentile

Selecting a region filters the shared evidence queue and opens a member list. A
duplicate regional mini-map is not shown.

The regional member ledger can pivot to an issue comparison limited to the
selected region. Each member row shows the latest transition and whether the issue
falls within a documented committee or representative opportunity.

Every regional member row links to the member ledger and exposes the same compact
member share action. Sponsorship details appear only after the member identity
drawer is opened.

### 5.6 Change Ledger

The dominant surface is a chronological causal ledger. Charts remain subordinate.
Every visible change links to the records that caused it.

The page explicitly distinguishes:

- Real-world behavior change
- Newly published official records
- Pipeline ingestion latency
- Coverage changes

Every visible delta links to the Before–After Dockets that produced it. Users can
regroup the same changes by issue to distinguish a broad issue-driven shift from
isolated member-level events.

## 6. Functional Data Requirements

### 6.1 Evidence record

The implementation requires a normalized evidence record with:

- Evidence ID
- Member ID
- Issue IDs
- Bill and vote IDs when available
- Record type
- Official event time
- Ingestion time
- Source URL and source version
- Source excerpt or navigable source location
- Evidence state
- Classification rationale
- Comparison baseline
- Coverage numerator and denominator
- Review and correction state

### 6.2 Issue docket

An issue docket requires:

- Stable issue ID and title
- Neutral issue description
- Related bills, votes, meetings, and committees
- Official milestones
- Relevant-member criteria
- Member evidence cells
- Opportunity definitions
- Coverage status
- Latest ingestion time

### 6.3 Opportunity record

A documented no-action state requires a separate opportunity record:

- Opportunity ID
- Responsible or relevant member set
- Opportunity type
- Observation window
- Expected public-record sources
- Observed-record count
- Missing-source coverage
- Resulting evidence state

The absence of a source export is not treated as member inactivity.

### 6.4 Versioning and corrections

New ingestion may amend, supersede, or correct an earlier record. The product must:

- Retain the prior version
- Show the correction timestamp
- Recompute affected transitions
- Mark superseded interpretations
- Preserve shareable evidence history
- Avoid presenting a pipeline correction as real-world behavior change

### 6.5 Sponsorship account record

The implementation requires a versioned sponsorship-account record:

- Member ID
- Bank name
- Published account number
- Account holder
- Official source URL
- Source publisher
- Published date
- Last verified date
- Valid-from and valid-to dates when available
- Verification state
- Superseded account record ID
- Review and correction state

Only records in the current verified state may be copied. Account changes retain
the prior version for audit history but never leave a superseded account copyable.

### 6.6 Member share metadata

Each member requires a pre-generated or server-rendered share document at a
fragment-free canonical path such as `/members/{member_id}/`. A hash-only route is
not sufficient because external link preview crawlers may not execute the
application or interpret URL fragments.

The document provides:

- Canonical URL
- `og:type`, `og:title`, `og:description`, `og:url`, and `og:image`
- `og:image:width=1200` and `og:image:height=630`
- `twitter:card=summary_large_image`
- Member-specific accessible page title and description
- A 1200×630 member performance image generated from the same normalized evidence
- A redirect or hydration path into the member accountability ledger
- A share-card version key for cache invalidation after evidence refresh

The metadata generator and in-product preview use the same input object so the
external card cannot disagree with the member ledger. Card facts include their
period and denominator in the rendered image or accessible description.

## 7. Tone and Manner

The visual direction is a Korean public-interest investigative newsroom combined
with an evidence terminal.

- Background: warm paper off-white
- Primary surface: white
- Primary text: deep ink
- Verified contribution: restrained civic teal
- Caution: amber
- Documented no-action: crimson
- Pending or unknown: slate blue-gray
- Headlines: Noto Serif KR
- UI and data: Noto Sans KR
- Numerals: tabular
- Radius: 4px
- Elevation: reserved for drawers, menus, and tooltips
- Separation: spacing, alignment, typography, and hairlines before borders

### 7.1 Lawmaker portrait treatment

Every lawmaker portrait uses a consistent grayscale halftone treatment inspired by
old newspaper photo printing.

- Preserve the original color image asset and apply the visual treatment at
  presentation time.
- Use a shared SVG filter for grayscale, tonal compression, and halftone texture.
- Provide a CSS-only grayscale fallback when the SVG filter is unavailable.
- Apply the same treatment to member lists, evidence records, tooltips, drawers,
  comparison tables, map cells, and member-detail views.
- Keep the face recognizable at compact sizes. Reduce or disable the halftone
  texture below the minimum size where the dot pattern obscures facial features.
- Do not bake the effect into downloaded source images.
- Verify GPU and paint cost on pages that render hundreds of member portraits.
- Preserve useful alt text and do not encode evidence state through portrait
  treatment.
- Respect print and high-contrast modes with a simplified grayscale rendering.
- Reuse the same treatment in the 1200×630 member share image.

Avoid:

- Bright blue primary buttons
- Party-color severity encoding
- Gradient backgrounds
- Decorative cartograms
- Generic dashboard card grids
- Gamified rankings
- Excessive pills
- Large rounded cards

## 8. Fairness and Accountability Rules

Every route must include the following principle in concise Korean copy:

> This is an observation signal within the scope of published records. It does not
> determine illegality, incompetence, or intent.

A documented no-action state is allowed only when:

1. The relevant responsibility or opportunity is defined.
2. The opportunity count is available.
3. The searched record scope is disclosed.
4. Missing source coverage is not misrepresented as inactivity.

## 9. Implementation Acceptance Criteria

- All six routes use the same global header, evidence record row, state marker, and
  evidence drawer.
- Default sorting uses ingestion time.
- Official event time remains visible.
- Every metric has a period, denominator, and source coverage.
- Member names link to the member accountability ledger.
- Charts and maps provide a table alternative.
- Severity never depends on color alone.
- Party colors are metadata only.
- Missing data is not rendered as zero.
- No composite moral score is present.
- Every eligible evidence record opens a Before–After Docket.
- Every issue-linked record opens the Issue Comparison Board in the correct issue
  context.
- A state or position change is never shown without comparable prior evidence.
- Every issue comparison distinguishes no published record from insufficient
  source coverage.
- Queue, issue, member, region, and trend routes preserve the selected evidence
  context in the URL.
- Source corrections update affected transitions without erasing prior versions.
- Every lawmaker portrait uses the shared grayscale halftone treatment, with a
  CSS fallback and compact-size legibility guard.
- A verified official sponsorship account can be copied from the member identity
  surface with visible success feedback.
- Missing, expired, conflicting, unverified, and superseded sponsorship accounts
  cannot be copied and are not rendered as current accounts.
- `계좌 정보 전체 복사` includes the official source URL and never includes
  unsupported payment instructions.
- Every member share action previews the exact card that external services receive.
- Every member has a fragment-free canonical share URL that opens the corresponding
  member accountability ledger.
- Open Graph and Twitter metadata identify the member, affiliation, representation
  type, observation period, and latest ingestion date.
- The 1200×630 member share image contains only evidence-backed facts and reduces
  its fact count when coverage is insufficient.
- Desktop layouts work at 1440px without clipped Korean text.
- Primary controls have at least a 44px target and a visible keyboard focus state.
