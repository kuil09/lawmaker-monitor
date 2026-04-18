import { createRequire } from "node:module";

import { describe, expect, it } from "vitest";

import {
  buildConstituencyBoundaryExport,
  parseConstituencyLawText
} from "../../packages/ingest/src/constituency-boundaries.js";
import { validateConstituencyBoundaryExport } from "../../packages/ingest/src/validation.js";

const require = createRequire(import.meta.url);
const wkx = require("wkx") as {
  Geometry: {
    parseGeoJSON(input: unknown): {
      toWkb(): Buffer;
    };
  };
};

function polygonHex(points: Array<[number, number]>): string {
  return wkx.Geometry.parseGeoJSON({
    type: "Polygon",
    coordinates: [points]
  })
    .toWkb()
    .toString("hex");
}

describe("constituency boundary builder", () => {
  it("parses official law text rows and merges 읍면동 polygons into district features", () => {
    const lawText = [
      "  국회의원지역선거구구역표 (지역구 : 3)",
      "│서울특별시(지역구 : 2)│",
      "│종로구선거구      │종로구 일원│",
      "│중구성동구갑선거구│성동구 왕십리제2동, 행당제1동,│",
      "│                  │중구 일원│",
      "│부산광역시(지역구 : 1)│",
      "│남구선거구        │남구 일원│"
    ].join("\n");

    expect(parseConstituencyLawText(lawText)).toEqual([
      {
        provinceName: "서울특별시",
        provinceShortName: "서울",
        lawDistrictName: "종로구선거구",
        districtName: "종로구",
        areaText: "종로구 일원"
      },
      {
        provinceName: "서울특별시",
        provinceShortName: "서울",
        lawDistrictName: "중구성동구갑선거구",
        districtName: "중구성동구갑",
        areaText: "성동구 왕십리제2동, 행당제1동,중구 일원"
      },
      {
        provinceName: "부산광역시",
        provinceShortName: "부산",
        lawDistrictName: "남구선거구",
        districtName: "남구",
        areaText: "남구 일원"
      }
    ]);

    const sigunguCsv = [
      "공간정보일렬번호,시군구코드,시군구명,객체시군구코드,오브젝트아이디,공간정보",
      "1,11110,종로구,11110,1,unused",
      "2,11140,중구,11140,2,unused",
      "3,11200,성동구,11200,3,unused",
      "4,26290,남구,26290,4,unused"
    ].join("\n");

    const emdCsv = [
      "공간정보일렬번호,읍면동코드,읍면동명,객체시군구코드,오브젝트아이디,공간정보",
      `1,11110101,사직동,11110,1,${polygonHex([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0]
      ])}`,
      `2,11110102,청운동,11110,2,${polygonHex([
        [1, 0],
        [2, 0],
        [2, 1],
        [1, 1],
        [1, 0]
      ])}`,
      `3,11140101,소공동,11140,3,${polygonHex([
        [0, 1],
        [1, 1],
        [1, 2],
        [0, 2],
        [0, 1]
      ])}`,
      `4,11200101,왕십리2동,11200,4,${polygonHex([
        [1, 1],
        [2, 1],
        [2, 2],
        [1, 2],
        [1, 1]
      ])}`,
      `5,11200102,행당1동,11200,5,${polygonHex([
        [2, 1],
        [3, 1],
        [3, 2],
        [2, 2],
        [2, 1]
      ])}`,
      `6,26290101,대연동,26290,6,${polygonHex([
        [10, 10],
        [11, 10],
        [11, 11],
        [10, 11],
        [10, 10]
      ])}`
    ].join("\n");

    const payload = validateConstituencyBoundaryExport(
      buildConstituencyBoundaryExport({
        generatedAt: "2026-03-28T16:00:00+09:00",
        lawEffectiveDate: "2026-03-19",
        lawSourceUrl:
          "https://www.law.go.kr/lsBylInfoPLinkR.do?lsiSeq=284577&bylNo=0001&bylBrNo=00&bylCls=BE&bylEfYd=20260319&bylEfYdYn=Y",
        lawText,
        lawSource: {
          sourceId: "law",
          title: "공직선거법 별표 1",
          downloadUrl: "https://www.law.go.kr/LSW/lsBylTextDownLoad.do",
          checksumSha256: "law-checksum",
          retrievedAt: "2026-03-28T16:00:00+09:00"
        },
        sigunguCsv,
        sigunguSource: {
          sourceId: "sigungu",
          title: "시군구 CSV",
          downloadUrl: "https://www.data.go.kr/sigungu.csv",
          checksumSha256: "sigungu-checksum",
          retrievedAt: "2026-03-28T16:00:00+09:00"
        },
        emdCsv,
        emdSource: {
          sourceId: "emd",
          title: "읍면동 CSV",
          downloadUrl: "https://www.data.go.kr/emd.csv",
          checksumSha256: "emd-checksum",
          retrievedAt: "2026-03-28T16:00:00+09:00"
        }
      })
    );

    expect(payload.features).toHaveLength(3);
    expect(payload.sources.map((source) => source.rowCount)).toEqual([3, 4, 6]);

    const jongno = payload.features[0];
    const jungSeongdongGap = payload.features[1];

    expect(jongno?.properties.memberDistrictLabel).toBe("서울 종로구");
    expect(jongno?.properties.aliases).toContain("서울 종로구");
    expect(jungSeongdongGap?.properties.memberDistrictKey).toBe(
      "서울중구성동구갑"
    );
    expect(jungSeongdongGap?.properties.sigunguNames).toEqual([
      "성동구",
      "중구"
    ]);
    expect(jungSeongdongGap?.properties.emdNames).toEqual([
      "소공동",
      "왕십리2동",
      "행당1동"
    ]);
    expect(["Polygon", "MultiPolygon"]).toContain(
      jungSeongdongGap?.geometry.type
    );
  });

  it("accepts duplicated and ordinal law suffixes when SGIS names omit the marker", () => {
    const lawText = [
      "│서울특별시(지역구 : 1)│",
      "│서대문구선거구│홍제제1동, 홍제제2동│"
    ].join("\n");

    const sigunguCsv = [
      "공간정보일렬번호,시군구코드,시군구명,객체시군구코드,오브젝트아이디,공간정보",
      "1,11130,서대문구,11130,1,unused"
    ].join("\n");

    const emdCsv = [
      "공간정보일렬번호,읍면동코드,읍면동명,객체시군구코드,오브젝트아이디,공간정보",
      `1,11130620,홍제1동,11130,1,${polygonHex([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0]
      ])}`,
      `2,11130650,홍제2동,11130,2,${polygonHex([
        [1, 0],
        [2, 0],
        [2, 1],
        [1, 1],
        [1, 0]
      ])}`
    ].join("\n");

    const payload = validateConstituencyBoundaryExport(
      buildConstituencyBoundaryExport({
        generatedAt: "2026-03-28T16:00:00+09:00",
        lawEffectiveDate: "2026-03-19",
        lawSourceUrl: "https://example.com/law",
        lawText,
        lawSource: {
          sourceId: "law",
          title: "공직선거법 별표 1",
          downloadUrl: "https://example.com/law.txt",
          checksumSha256: "law-checksum",
          retrievedAt: "2026-03-28T16:00:00+09:00"
        },
        sigunguCsv,
        sigunguSource: {
          sourceId: "sigungu",
          title: "시군구 CSV",
          downloadUrl: "https://example.com/sigungu.csv",
          checksumSha256: "sigungu-checksum",
          retrievedAt: "2026-03-28T16:00:00+09:00"
        },
        emdCsv,
        emdSource: {
          sourceId: "emd",
          title: "읍면동 CSV",
          downloadUrl: "https://example.com/emd.csv",
          checksumSha256: "emd-checksum",
          retrievedAt: "2026-03-28T16:00:00+09:00"
        }
      })
    );

    expect(payload.features).toHaveLength(1);
    expect(payload.features[0]?.properties.emdNames).toEqual([
      "홍제1동",
      "홍제2동"
    ]);
  });

  it("collapses historical numeric subdivisions into a merged administrative dong when SGIS only has the merged name", () => {
    const lawText = [
      "│전북특별자치도(지역구 : 1)│",
      "│전주시병선거구│전주시 덕진구 금암1동, 금암2동│"
    ].join("\n");

    const sigunguCsv = [
      "공간정보일렬번호,시군구코드,시군구명,객체시군구코드,오브젝트아이디,공간정보",
      "1,45113,전주시 덕진구,45113,1,unused"
    ].join("\n");

    const emdCsv = [
      "공간정보일렬번호,읍면동코드,읍면동명,객체시군구코드,오브젝트아이디,공간정보",
      `1,45113710,금암동,45113,1,${polygonHex([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0]
      ])}`
    ].join("\n");

    const payload = validateConstituencyBoundaryExport(
      buildConstituencyBoundaryExport({
        generatedAt: "2026-03-28T16:00:00+09:00",
        lawEffectiveDate: "2026-03-19",
        lawSourceUrl: "https://example.com/law",
        lawText,
        lawSource: {
          sourceId: "law",
          title: "공직선거법 별표 1",
          downloadUrl: "https://example.com/law.txt",
          checksumSha256: "law-checksum",
          retrievedAt: "2026-03-28T16:00:00+09:00"
        },
        sigunguCsv,
        sigunguSource: {
          sourceId: "sigungu",
          title: "시군구 CSV",
          downloadUrl: "https://example.com/sigungu.csv",
          checksumSha256: "sigungu-checksum",
          retrievedAt: "2026-03-28T16:00:00+09:00"
        },
        emdCsv,
        emdSource: {
          sourceId: "emd",
          title: "읍면동 CSV",
          downloadUrl: "https://example.com/emd.csv",
          checksumSha256: "emd-checksum",
          retrievedAt: "2026-03-28T16:00:00+09:00"
        }
      })
    );

    expect(payload.features).toHaveLength(1);
    expect(payload.features[0]?.properties.emdNames).toEqual(["금암동"]);
  });

  it("keeps district names intact when the law table wraps the left cell with a standalone 선거구 row", () => {
    const lawText = [
      "│인천광역시(지역구 : 1)│",
      "│동구미추홀구갑│미추홀구 도화1동, 주안1동,│",
      "│선거구        │주안6동, 동구 일원│"
    ].join("\n");

    expect(parseConstituencyLawText(lawText)).toEqual([
      {
        provinceName: "인천광역시",
        provinceShortName: "인천",
        lawDistrictName: "동구미추홀구갑선거구",
        districtName: "동구미추홀구갑",
        areaText: "미추홀구 도화1동, 주안1동,주안6동, 동구 일원"
      }
    ]);
  });

  it("reconstructs wrapped district labels and sigungu prefixes across table rows", () => {
    const lawText = [
      "│경기도(지역구 : 1)│",
      "│수원시무선거구│수원시 권선구 세류2동, 곡선동, 수원시 영통구│",
      "│            │영통2동, 망포1동│",
      "│강원특별자치도(지역구 : 1)│",
      "│춘천시철원군화천군│춘천시 동산면, 교동│",
      "│양구군갑선거구    │소양동, 후평1동│"
    ].join("\n");

    expect(parseConstituencyLawText(lawText)).toEqual([
      {
        provinceName: "경기도",
        provinceShortName: "경기",
        lawDistrictName: "수원시무선거구",
        districtName: "수원시무",
        areaText:
          "수원시 권선구 세류2동, 곡선동, 수원시 영통구 영통2동, 망포1동"
      },
      {
        provinceName: "강원특별자치도",
        provinceShortName: "강원",
        lawDistrictName: "춘천시철원군화천군양구군갑선거구",
        districtName: "춘천시철원군화천군양구군갑",
        areaText: "춘천시 동산면, 교동 소양동, 후평1동"
      }
    ]);
  });
});
