# Parser Structure

The public parser surface stays at `packages/ingest/src/parsers.ts`.

Internal responsibilities now live in focused modules:

- `helpers.ts`: shared XML, date, URL, source-record, and normalization helpers.
- `types.ts`: parser-facing exported types that other ingest modules reuse.
- `votes.ts`: plenary vote, agenda, meeting, and live-signal parsers.
- `members.ts`: current-member roster, ALLNAMEMBER profile, and tenure-history parsers.
- `committees.ts`: committee roster, committee overview, and bill vote summary parsers.

When adding a new parser:

- add shared primitives only when at least two domains need them
- keep the external export surface stable through `parsers.ts`
- place fixture tests next to the domain boundary they exercise in `tests/ingest`
