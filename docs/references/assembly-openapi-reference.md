# Assembly OpenAPI Reference

## Canonical Rule

This repository now treats the original National Assembly Secretariat PDF guide,
`오픈API활용가이드 (2023-11)`, as the top-level source of truth.

- `docs/references/assembly-openapi-endpoints.json` is the machine-readable registry derived from that PDF.
- Runtime collection must use only official OpenAPI endpoints listed in the registry.
- Endpoint selection is fixed in code. Environment variables must not swap service paths, base URLs, or assembly fallbacks.

## PDF-Reverified Official Endpoints

These endpoints were visually re-verified against the original PDF and are used directly by the current runtime.

| PDF page | Role | Korean service name | Service code | Official URL |
| --- | --- | --- | --- | --- |
| 4 | Current member roster metadata | 국회의원 인적사항 | `nwvrqwxyaytdsfvhu` | `https://open.assembly.go.kr/portal/openapi/nwvrqwxyaytdsfvhu` |
| 4 | Member tenure history | 국회의원 의원이력 | `nexgtxtmaamffofof` | `https://open.assembly.go.kr/portal/openapi/nexgtxtmaamffofof` |
| 4 | Member committee affiliation history | 국회의원 위원회 경력 | `nyzrglyvagmrvpezq` | `https://open.assembly.go.kr/portal/openapi/nyzrglyvagmrvpezq` |
| 4 | Member-level plenary vote detail | 국회의원 본회의 표결정보 | `nojepdqqaweusdfbi` | `https://open.assembly.go.kr/portal/openapi/nojepdqqaweusdfbi` |
| 4 | Standing-committee activity | 국회의원 상임위 활동 | `nuvypcdgahexhvrjt` | `https://open.assembly.go.kr/portal/openapi/nuvypcdgahexhvrjt` |
| 6 | Committee metadata | 위원회 현황 정보 | `nxrvzonlafugpqjuh` | `https://open.assembly.go.kr/portal/openapi/nxrvzonlafugpqjuh` |
| 6 | Committee membership roster | 위원회 위원 명단 | `nktulghcadyhmiqxi` | `https://open.assembly.go.kr/portal/openapi/nktulghcadyhmiqxi` |
| 7 | Official roll-call tally counts | 의안별 표결현황 | `ncocpgfiaoituanbr` | `https://open.assembly.go.kr/portal/openapi/ncocpgfiaoituanbr` |

## Official Endpoints Still Pending Direct PDF Re-Verification

The runtime still uses these official OpenAPI endpoints, but this repository update did not yet re-cite their exact PDF pages. They remain in the registry under `pendingOfficialVerification`.

- `국회의원 인적사항 (ALLNAMEMBER)` for member photo and expanded profile enrichment
- `본회의 일정 (nekcaiymatialqlxr)`
- `본회의 처리안건_법률안 (nwbpacrgavhjryiph)`
- `본회의 처리안건_예산안 (nzgjnvnraowulzqwl)`
- `본회의 처리안건_결산안 (nkalemivaqmoibxro)`
- `본회의 처리안건_기타 (nbslryaradshbpbpm)`
- `본회의 회의록 (nzbyfwhwaoanttzje)`
- `실시간 의사중계 현황 (WEBCASTREALTIEM)`

## Runtime Rules

1. Runtime collection must not use `searchSheetData.do` or `downloadSheetData.do`.
2. Raw snapshot manifests must contain only official endpoint kinds and official service URLs.
3. Public export shape should stay stable when runtime sources change.
4. If an official source cannot supply a required field, the build should fail instead of silently restoring a legacy fallback.

## Related Files

- `docs/references/assembly-openapi-endpoints.json`
- `docs/references/assembly-source-inventory.md`
- `packages/ingest/src/assembly-source-registry.ts`
- `packages/ingest/src/assembly-api.ts`
