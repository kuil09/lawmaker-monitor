# Constituency Boundary Pipeline

This document describes the reproducible handoff for constituency-level map data used by the district visualization workstream.

## Output

- `artifacts/constituency-boundaries/current/constituency_boundaries.geojson`
- `artifacts/constituency-boundaries/current/source_manifest.json`
- `artifacts/build/exports/constituency_boundaries/index.json`
- `artifacts/build/exports/constituency_boundaries/provinces/<provinceShortName>.topo.json`

The GeoJSON file is a feature collection of current National Assembly constituency boundaries with:

- official law district names
- member-facing district aliases for matching the Assembly `district` field
- resolved `sigungu` and `emd` codes and names
- dissolved district geometries

## Official Sources

1. Public law source
- Page: `https://www.law.go.kr/lsBylInfoPLinkR.do?lsiSeq=284577&lsNm=%EA%B3%B5%EC%A7%81%EC%84%A0%EA%B1%B0%EB%B2%95&bylNo=0001&bylBrNo=00&bylCls=BE&bylEfYd=20260319&bylEfYdYn=Y`
- Download endpoint: `https://www.law.go.kr/LSW/lsBylTextDownLoad.do`
- Request body: `bylSeq=18012299&title=%5B%EB%B3%84%ED%91%9C+1%5D+%EA%B5%AD%ED%9A%8C%EC%9D%98%EC%9B%90%EC%A7%80%EC%97%AD%EC%84%A0%EA%B1%B0%EA%B5%AC%EA%B5%AC%EC%97%AD%ED%91%9C+%28%EC%A7%80%EC%97%AD%EA%B5%AC+%3A+254%29&mode=0`

2. Official SGIS admin boundary bundle
- data page: `https://www.data.go.kr/data/15129688/fileData.do`
- direct download: `https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003601705&fileDetailSn=1&insertDataPrcus=N`
- consumed layers:
  - `bnd_sigungu_00_2025_2Q.*`
  - `bnd_dong_00_2025_2Q.*`

## Build Command

```bash
npm run build --workspace @lawmaker-monitor/schemas
npm run build --workspace @lawmaker-monitor/ingest
npm run build:constituency-boundaries
npm run build:data --workspace @lawmaker-monitor/ingest
```

Optional overrides:

```bash
OUTPUT_DIR=artifacts/constituency-boundaries/current \
FETCH_TIMEOUT_MS=180000 \
npm run build:constituency-boundaries

CONSTITUENCY_BOUNDARIES_DIR=artifacts/constituency-boundaries/current \
OUTPUT_DIR=artifacts/build \
npm run build:data --workspace @lawmaker-monitor/ingest
```

## Mapping Rules

- The law source is authoritative for district-to-admin-unit membership.
- The SGIS `sigungu` shapefile provides the official `sigungu` code-to-name table used for administrative-dong attribution.
- The SGIS `dong` shapefile provides official administrative-dong boundaries and `ADM_CD` codes.
- Administrative dongs are assigned to `sigungu` by the first five digits of `ADM_CD`, then matched against law text with conservative fallback variants for duplicated or ordinal `제` markers.
- Member district aliases are emitted with province short forms such as `서울`, `부산`, `경기`, `전북`, and `세종`.

## Current Delivery Scope

- `build:constituency-boundaries` is the reproducible source artifact step.
- `build-data` republishes that artifact as a shared runtime contract through:
  - `manifests/latest.json -> exports.constituencyBoundariesIndex`
  - `exports/constituency_boundaries/index.json`
  - `exports/constituency_boundaries/provinces/<provinceShortName>.topo.json`
- Province shards intentionally preserve the full district geometry plus matching metadata while staying under the existing published JSON size guard.
