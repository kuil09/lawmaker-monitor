# Assembly Source Inventory

This file breaks the ingest pipeline down by published surface and records:

- the current runtime source,
- the target official source,
- the important field mapping,
- and whether the runtime is already on the intended official path.

`coverage status` meanings:

- `exact`: runtime already uses the intended official source and preserves the published contract.
- `supplemental`: endpoint is part of the official source inventory but is not currently required to preserve the published contract.

| Surface | Current runtime source | Target official source | Field mapping summary | Coverage status |
| --- | --- | --- | --- | --- |
| `latest_votes` vote facts | `국회의원 본회의 표결정보 (nojepdqqaweusdfbi)` | same | `rollCalls`, `voteFacts`, member vote names, vote codes | `exact` |
| `latest_votes` official tally | `의안별 표결현황 (ncocpgfiaoituanbr)` | same | `registeredCount`, `presentCount`, `yesCount`, `noCount`, `abstainCount`, `invalidCount`, `absentListStatus` validation input | `exact` |
| `accountability_summary` | `국회의원 인적사항 (nwvrqwxyaytdsfvhu)`, `국회의원 인적사항 (ALLNAMEMBER)`, `국회의원 의원이력`, `위원회 현황 정보`, `위원회 위원 명단`, `국회의원 본회의 표결정보` | same | current member roster, photo/profile enrichment, committee context, member-centric vote aggregation | `exact` |
| `accountability_trends` | `국회의원 인적사항 (nwvrqwxyaytdsfvhu)`, `국회의원 인적사항 (ALLNAMEMBER)`, `국회의원 의원이력`, `국회의원 본회의 표결정보` | same | current member roster, optional profile enrichment, rolling vote windows | `exact` |
| `member_activity_calendar` | `국회의원 인적사항 (nwvrqwxyaytdsfvhu)`, `국회의원 인적사항 (ALLNAMEMBER)`, `국회의원 의원이력`, `위원회 현황 정보`, `위원회 위원 명단`, `국회의원 본회의 표결정보` | same | member header metadata, optional profile enrichment, committee summaries, daily vote states, detailed vote records | `exact` |
| current member metadata | `국회의원 인적사항 (nwvrqwxyaytdsfvhu)` + `국회의원 인적사항 (ALLNAMEMBER)` + `국회의원 의원이력 (nexgtxtmaamffofof)` | same | `memberId`, `name`, `party`, `district`, current-assembly roster, `photoUrl`, synthesized `officialProfileUrl`, `officialExternalUrl`, extended profile metadata | `exact` |
| committee memberships | `위원회 위원 명단 (nktulghcadyhmiqxi)` + `위원회 현황 정보 (nxrvzonlafugpqjuh)` | same | `committeeMemberships`, committee summaries, current committee alert context | `exact` |
| official tally | `의안별 표결현황 (ncocpgfiaoituanbr)` | same | roll-call aggregate counts used by `latest_votes` and absent-list verification | `exact` |
| meeting discovery | `본회의 일정 (nekcaiymatialqlxr)` | same | plenary meeting ids, dates, session numbers | `exact` |
| plenary agenda discovery | `본회의 처리안건_*` feeds | same | bill ids, bill names, committee names, summaries | `exact` |
| plenary minutes | `본회의 회의록 (nzbyfwhwaoanttzje)` | same | source traceability and future context enrichment | `exact` |
| live session signal | `실시간 의사중계 현황 (WEBCASTREALTIEM)` | same | `isLive`, live title, committee name | `exact` |
| member committee history reference | `국회의원 위원회 경력 (nyzrglyvagmrvpezq)` | same | supplemental official source for future committee backfills and parity checks | `supplemental` |
| standing committee activity reference | `국회의원 상임위 활동 (nuvypcdgahexhvrjt)` | same | supplemental official source for future committee activity enrichment | `supplemental` |

## Current Runtime Source Set

The ingest runtime now treats the following as the authoritative official source set:

1. `memberInfo`
2. `memberProfileAll`
3. `memberHistory`
4. `committeeOverview`
5. `committeeRoster`
6. `votes`
7. `billVoteSummary`
8. `plenarySchedule`
9. `plenaryBillsLaw`
10. `plenaryBillsBudget`
11. `plenaryBillsSettlement`
12. `plenaryBillsOther`
13. `plenaryMinutes`
14. `liveWebcast`
