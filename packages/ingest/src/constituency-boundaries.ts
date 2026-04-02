import { execFile as nodeExecFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type {
  ConstituencyBoundaryExport,
  ConstituencyBoundaryFeature,
  ConstituencyBoundarySource,
  GeoJsonMultiPolygon,
  GeoJsonPolygon
} from "@lawmaker-monitor/schemas";

import { sha256Buffer } from "./utils.js";

const require = createRequire(import.meta.url);
const iconv = require("iconv-lite") as {
  decode(input: Buffer, encoding: string): string;
};
const wkx = require("wkx") as {
  Geometry: {
    parse(input: Buffer): {
      toGeoJSON(): GeoJsonGeometry;
    };
  };
};
const shapefile = require("shapefile") as {
  read(
    shp: ArrayBuffer | Buffer,
    dbf?: ArrayBuffer | Buffer,
    options?: { encoding?: string }
  ): Promise<GeoJsonFeatureCollection>;
};
const topojsonClient = require("topojson-client") as {
  merge(topology: Topology, objects: TopologyGeometry[]): GeoJsonGeometry;
};
const topojsonServer = require("topojson-server") as {
  topology(objects: Record<string, GeoJsonFeatureCollection>): Topology;
};
const execFile = promisify(nodeExecFile);

type GeoJsonGeometry = GeoJsonPolygon | GeoJsonMultiPolygon;

type GeoJsonFeature = {
  type: "Feature";
  id?: string;
  properties: Record<string, unknown>;
  geometry: GeoJsonGeometry;
};

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
};

type TopologyGeometry = {
  type: string;
  id?: string | number;
  properties?: Record<string, unknown>;
};

type TopologyObject = {
  type: "GeometryCollection";
  geometries: TopologyGeometry[];
};

type Topology = {
  type: "Topology";
  objects: Record<string, TopologyObject>;
};

type ProvinceInfo = {
  officialCode: string;
  sgisCode: string;
  fullName: string;
  shortName: string;
};

export type ConstituencyLawRecord = {
  provinceName: string;
  provinceShortName: string;
  lawDistrictName: string;
  districtName: string;
  areaText: string;
};

export type NgiiSigunguRecord = {
  sigunguCode: string;
  sigunguObjectCode: string | null;
  sigunguName: string;
};

export type NgiiEmdRecord = {
  emdCode: string;
  emdName: string;
  sigunguCode: string;
  geometry: GeoJsonGeometry;
};

type IndexedEmdRecord = NgiiEmdRecord & {
  provinceName: string;
  provinceShortName: string;
  officialSigunguCode: string;
  sigunguName: string;
};

type DownloadedSource = {
  content: Buffer;
  retrievedAt: string;
};

type DownloadedTextSource = {
  text: string;
  source: ConstituencyBoundarySource;
};

type DownloadedBoundaryBundle = {
  indexedEmdRecords: IndexedEmdRecord[];
  sigunguSource: ConstituencyBoundarySource;
  emdSource: ConstituencyBoundarySource;
};

type SigunguGeometryRecord = {
  sigunguCode: string;
  sigunguName: string;
  geometry: GeoJsonGeometry;
  bbox: [number, number, number, number];
};

type DongGeometryRecord = {
  emdCode: string;
  emdName: string;
  geometry: GeoJsonGeometry;
};

export const CONSTITUENCY_LAW_PAGE_URL =
  "https://www.law.go.kr/lsBylInfoPLinkR.do?lsiSeq=284577&lsNm=%EA%B3%B5%EC%A7%81%EC%84%A0%EA%B1%B0%EB%B2%95&bylNo=0001&bylBrNo=00&bylCls=BE&bylEfYd=20260319&bylEfYdYn=Y";
export const CONSTITUENCY_LAW_DOWNLOAD_URL = "https://www.law.go.kr/LSW/lsBylTextDownLoad.do";
export const CONSTITUENCY_LAW_DOWNLOAD_BODY = new URLSearchParams({
  bylSeq: "18012299",
  title: "[별표 1] 국회의원지역선거구구역표 (지역구 : 254)",
  mode: "0"
}).toString();
export const CONSTITUENCY_LAW_EFFECTIVE_DATE = "2026-03-19";

export const SGIS_BOUNDARY_DATA_PAGE_URL = "https://www.data.go.kr/data/15129688/fileData.do";
export const SGIS_BOUNDARY_DOWNLOAD_URL =
  "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003601705&fileDetailSn=1&insertDataPrcus=N";

export const NGII_SIGUNGU_DATA_PAGE_URL = "https://www.data.go.kr/data/15123131/fileData.do";
export const NGII_SIGUNGU_DOWNLOAD_URL =
  "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002819519&fileDetailSn=1&insertDataPrcus=N";

export const NGII_EMD_DATA_PAGE_URL = "https://www.data.go.kr/data/15123128/fileData.do";
export const NGII_EMD_DOWNLOAD_URL =
  "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000002819529&fileDetailSn=1&insertDataPrcus=N";

const DEFAULT_FETCH_TIMEOUT_MS = 120_000;

const PROVINCES: ProvinceInfo[] = [
  { officialCode: "11", sgisCode: "11", fullName: "서울특별시", shortName: "서울" },
  { officialCode: "26", sgisCode: "21", fullName: "부산광역시", shortName: "부산" },
  { officialCode: "27", sgisCode: "22", fullName: "대구광역시", shortName: "대구" },
  { officialCode: "28", sgisCode: "23", fullName: "인천광역시", shortName: "인천" },
  { officialCode: "29", sgisCode: "24", fullName: "광주광역시", shortName: "광주" },
  { officialCode: "30", sgisCode: "25", fullName: "대전광역시", shortName: "대전" },
  { officialCode: "31", sgisCode: "26", fullName: "울산광역시", shortName: "울산" },
  { officialCode: "36", sgisCode: "29", fullName: "세종특별자치시", shortName: "세종" },
  { officialCode: "41", sgisCode: "31", fullName: "경기도", shortName: "경기" },
  { officialCode: "42", sgisCode: "32", fullName: "강원특별자치도", shortName: "강원" },
  { officialCode: "43", sgisCode: "33", fullName: "충청북도", shortName: "충북" },
  { officialCode: "44", sgisCode: "34", fullName: "충청남도", shortName: "충남" },
  { officialCode: "45", sgisCode: "35", fullName: "전북특별자치도", shortName: "전북" },
  { officialCode: "46", sgisCode: "36", fullName: "전라남도", shortName: "전남" },
  { officialCode: "47", sgisCode: "37", fullName: "경상북도", shortName: "경북" },
  { officialCode: "48", sgisCode: "38", fullName: "경상남도", shortName: "경남" },
  { officialCode: "50", sgisCode: "39", fullName: "제주특별자치도", shortName: "제주" }
];

const provinceByOfficialCode = new Map(PROVINCES.map((item) => [item.officialCode, item] as const));
const provinceBySgisCode = new Map(PROVINCES.map((item) => [item.sgisCode, item] as const));
const provinceByFullName = new Map(PROVINCES.map((item) => [item.fullName, item] as const));

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeAdministrativeNameKey(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\s+/g, "")
    .replace(/[ㆍ?]/g, "·");
}

function normalizeLawCell(value: string): string {
  return normalizeWhitespace(value).replace(/[ㆍ?]/g, "·");
}

function collapseDuplicateOrdinalMarker(value: string): string {
  return value.replace(/제제(?=\d+(?:·\d+)*[동리읍면가])/g, "제");
}

function stripOrdinalMarker(value: string): string {
  return value.replace(/제(?=\d+(?:·\d+)*[동리읍면가])/g, "");
}

function buildAdministrativeNameMatchKeys(value: string): string[] {
  const exact = normalizeAdministrativeNameKey(value);
  const collapsed = normalizeAdministrativeNameKey(collapseDuplicateOrdinalMarker(value));
  const stripped = normalizeAdministrativeNameKey(stripOrdinalMarker(collapseDuplicateOrdinalMarker(value)));
  return [...new Set([exact, collapsed, stripped])];
}

function buildCollapsedSubdivisionKey(value: string): string | null {
  const digitCount = value.match(/\d/g)?.length ?? 0;
  if (digitCount !== 1) {
    return null;
  }
  return normalizeAdministrativeNameKey(value.replace(/\d+(?=[동리])/, ""));
}

function buildMemberDistrictLabel(province: ProvinceInfo, districtName: string): string {
  const shortenedDistrictName = districtName
    .replace(/특별자치시/g, "시")
    .replace(/특별자치도/g, "도");
  return `${province.shortName} ${shortenedDistrictName}`;
}

function buildDistrictAliases(province: ProvinceInfo, districtName: string): string[] {
  const shortenedDistrictName = districtName
    .replace(/특별자치시/g, "시")
    .replace(/특별자치도/g, "도");
  const aliases = new Set<string>([
    districtName,
    shortenedDistrictName,
    `${province.fullName} ${districtName}`,
    `${province.fullName}${districtName}`,
    `${province.shortName} ${districtName}`,
    `${province.shortName}${districtName}`,
    `${province.shortName} ${shortenedDistrictName}`,
    `${province.shortName}${shortenedDistrictName}`
  ]);
  return [...aliases].sort((left, right) => left.localeCompare(right, "ko"));
}

function parseLawLineCells(line: string): string[] {
  const cells = [...line.matchAll(/│([^│]*)/g)].map((match) => normalizeLawCell(match[1] ?? ""));
  if (cells.at(-1) === "") {
    return cells.slice(0, -1);
  }
  return cells;
}

function joinLawFragments(fragments: string[]): string {
  return fragments.reduce((result, fragment) => {
    if (!result) {
      return fragment;
    }
    if (/[,(]$/.test(result) || /^[,)]/.test(fragment)) {
      return `${result}${fragment}`;
    }
    return `${result} ${fragment}`;
  }, "");
}

export function parseConstituencyLawText(text: string): ConstituencyLawRecord[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const records: ConstituencyLawRecord[] = [];
  let currentProvince: ProvinceInfo | null = null;
  let currentDistrictName = "";
  let currentAreaFragments: string[] = [];

  const pushCurrent = () => {
    if (!currentProvince || !currentDistrictName) {
      currentDistrictName = "";
      currentAreaFragments = [];
      return;
    }

    records.push({
      provinceName: currentProvince.fullName,
      provinceShortName: currentProvince.shortName,
      lawDistrictName: currentDistrictName,
      districtName: currentDistrictName.replace(/선거구$/, ""),
      areaText: joinLawFragments(currentAreaFragments)
    });
    currentDistrictName = "";
    currentAreaFragments = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.startsWith("│")) {
      continue;
    }

    const cells = parseLawLineCells(line);
    if (cells.length === 0) {
      continue;
    }

    if (cells.length === 1) {
      const heading = cells[0] ?? "";
      const provinceName = heading.split("(")[0]?.trim() ?? "";
      const province = provinceByFullName.get(provinceName);
      if (province && heading.includes("지역구")) {
        pushCurrent();
        currentProvince = province;
      }
      continue;
    }

    const left = cells[0] ?? "";
    const right = cells[1] ?? "";
    if (normalizeAdministrativeNameKey(left) === "선거구명") {
      continue;
    }

    if (left === "선거구" && currentDistrictName) {
      currentDistrictName = `${currentDistrictName}${left}`;
      if (right) {
        currentAreaFragments.push(right);
      }
      continue;
    }

    if (currentDistrictName && !currentDistrictName.endsWith("선거구") && left.endsWith("선거구")) {
      currentDistrictName = `${currentDistrictName}${left}`;
      if (right) {
        currentAreaFragments.push(right);
      }
      continue;
    }

    if (left) {
      pushCurrent();
      if (!currentProvince) {
        throw new Error(`Could not resolve province header before district row "${left}".`);
      }
      currentDistrictName = left;
      currentAreaFragments = right ? [right] : [];
      continue;
    }

    if (currentDistrictName && right) {
      currentAreaFragments.push(right);
    }
  }

  pushCurrent();

  if (records.length === 0) {
    throw new Error("Failed to parse any constituency rows from the official law text.");
  }

  return records;
}

function listOuterRings(geometry: GeoJsonGeometry): Array<Array<[number, number]>> {
  if (geometry.type === "Polygon") {
    const outer = geometry.coordinates[0] ?? [];
    return [outer];
  }

  return geometry.coordinates
    .map((polygon) => polygon[0] ?? [])
    .filter((ring): ring is Array<[number, number]> => ring.length > 0);
}

function computeRingBBox(ring: Array<[number, number]>): [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return [minX, minY, maxX, maxY];
}

function computeGeometryBBox(geometry: GeoJsonGeometry): [number, number, number, number] {
  const rings = listOuterRings(geometry);
  const initial: [number, number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY
  ];

  return rings.reduce<[number, number, number, number]>((bbox, ring) => {
    const [minX, minY, maxX, maxY] = computeRingBBox(ring);
    return [
      Math.min(bbox[0], minX),
      Math.min(bbox[1], minY),
      Math.max(bbox[2], maxX),
      Math.max(bbox[3], maxY)
    ];
  }, initial);
}

function buildProbePoints(geometry: GeoJsonGeometry): Array<[number, number]> {
  const rings = listOuterRings(geometry);
  const ringArea = (ring: Array<[number, number]>): number => {
    const [minX, minY, maxX, maxY] = computeRingBBox(ring);
    return Math.max(0, maxX - minX) * Math.max(0, maxY - minY);
  };
  const largestRing =
    rings
      .slice()
      .sort((left, right) => ringArea(right) - ringArea(left))[0] ??
    [];
  const bbox = computeGeometryBBox(geometry);
  const bboxCenter: [number, number] = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
  const coordinateAverage: [number, number] =
    largestRing.length > 0
      ? [
          largestRing.reduce((sum, point) => sum + point[0], 0) / largestRing.length,
          largestRing.reduce((sum, point) => sum + point[1], 0) / largestRing.length
        ]
      : bboxCenter;
  const firstPoint = largestRing[0] ?? bboxCenter;
  const edgeMidpoints = largestRing.slice(0, 12).map((point, index) => {
    const next = largestRing[(index + 1) % largestRing.length] ?? point;
    return [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2] as [number, number];
  });

  return [bboxCenter, coordinateAverage, firstPoint, ...edgeMidpoints];
}

function bboxContainsPoint(
  bbox: [number, number, number, number],
  point: [number, number]
): boolean {
  return point[0] >= bbox[0] && point[0] <= bbox[2] && point[1] >= bbox[1] && point[1] <= bbox[3];
}

function pointInRing(point: [number, number], ring: Array<[number, number]>): boolean {
  let inside = false;

  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [x1, y1] = ring[index] ?? [0, 0];
    const [x2, y2] = ring[previous] ?? [0, 0];
    const intersects =
      (y1 > point[1]) !== (y2 > point[1]) &&
      point[0] < ((x2 - x1) * (point[1] - y1)) / ((y2 - y1) || Number.EPSILON) + x1;
    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function pointInGeometry(point: [number, number], geometry: GeoJsonGeometry): boolean {
  if (geometry.type === "Polygon") {
    const [outerRing, ...holes] = geometry.coordinates;
    if (!outerRing || !pointInRing(point, outerRing)) {
      return false;
    }
    return !holes.some((ring) => pointInRing(point, ring));
  }

  return geometry.coordinates.some((polygon) => {
    const [outerRing, ...holes] = polygon;
    if (!outerRing || !pointInRing(point, outerRing)) {
      return false;
    }
    return !holes.some((ring) => pointInRing(point, ring));
  });
}

function findProvinceBySigunguCode(sigunguCode: string): ProvinceInfo {
  const province = provinceBySgisCode.get(sigunguCode.slice(0, 2));
  if (!province) {
    throw new Error(`Unknown province prefix for sigungu ${sigunguCode}.`);
  }
  return province;
}

async function extractSgisShapefile(args: {
  zipBuffer: Buffer;
  basename: string;
}): Promise<{
  shp: Buffer;
  dbf: Buffer;
  cpg: string;
}> {
  const tempRoot = await mkdtemp(join(tmpdir(), "sgis-boundary-"));
  const zipPath = join(tempRoot, "sgis-boundaries.zip");

  try {
    await writeFile(zipPath, args.zipBuffer);
    await execFile("unzip", ["-j", zipPath, `*${args.basename}.*`, "-d", tempRoot]);

    const [shp, dbf, cpg] = await Promise.all([
      readFile(join(tempRoot, `${args.basename}.shp`)),
      readFile(join(tempRoot, `${args.basename}.dbf`)),
      readFile(join(tempRoot, `${args.basename}.cpg`), "utf8")
    ]);

    return {
      shp,
      dbf,
      cpg: cpg.trim()
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function readSgisFeatureCollection(args: {
  zipBuffer: Buffer;
  basename: string;
}): Promise<GeoJsonFeatureCollection> {
  const { shp, dbf, cpg } = await extractSgisShapefile(args);
  return shapefile.read(shp, dbf, {
    encoding: cpg || "utf-8"
  });
}

function parseSgisSigunguRecords(collection: GeoJsonFeatureCollection): SigunguGeometryRecord[] {
  return collection.features.map((feature) => {
    const sigunguCode = String(feature.properties.SIGUNGU_CD ?? "").trim();
    const sigunguName = String(feature.properties.SIGUNGU_NM ?? "").trim();
    if (!sigunguCode || !sigunguName) {
      throw new Error("SGIS sigungu shapefile is missing SIGUNGU_CD or SIGUNGU_NM.");
    }
    return {
      sigunguCode,
      sigunguName,
      geometry: feature.geometry,
      bbox: computeGeometryBBox(feature.geometry)
    };
  });
}

function parseSgisDongRecords(collection: GeoJsonFeatureCollection): DongGeometryRecord[] {
  return collection.features.map((feature) => {
    const emdCode = String(feature.properties.ADM_CD ?? "").trim();
    const emdName = String(feature.properties.ADM_NM ?? "").trim();
    if (!emdCode || !emdName) {
      throw new Error("SGIS dong shapefile is missing ADM_CD or ADM_NM.");
    }
    return {
      emdCode,
      emdName,
      geometry: feature.geometry
    };
  });
}

function assignDongToSigungu(args: {
  dong: DongGeometryRecord;
  sigunguRecords: SigunguGeometryRecord[];
}): SigunguGeometryRecord {
  const probePoints = buildProbePoints(args.dong.geometry);

  for (const point of probePoints) {
    const bboxCandidates = args.sigunguRecords.filter((record) => bboxContainsPoint(record.bbox, point));
    const matches = bboxCandidates.filter((record) => pointInGeometry(point, record.geometry));
    if (matches.length === 1) {
      const match = matches[0];
      if (match) {
        return match;
      }
    }
  }

  throw new Error(`Could not assign administrative dong ${args.dong.emdCode} to a sigungu geometry.`);
}

async function loadSgisBoundaryBundle(args: {
  download: DownloadedSource;
}): Promise<DownloadedBoundaryBundle> {
  const [sigunguCollection, dongCollection] = await Promise.all([
    readSgisFeatureCollection({
      zipBuffer: args.download.content,
      basename: "bnd_sigungu_00_2025_2Q"
    }),
    readSgisFeatureCollection({
      zipBuffer: args.download.content,
      basename: "bnd_dong_00_2025_2Q"
    })
  ]);

  const sigunguSource = buildSource({
    sourceId: "sgis-bnd-sigungu-2025-2q",
    title: "SGIS 2025 Q2 sigungu boundary shapefile",
    sourcePageUrl: SGIS_BOUNDARY_DATA_PAGE_URL,
    downloadUrl: SGIS_BOUNDARY_DOWNLOAD_URL,
    requestMethod: "GET",
    encoding: "utf-8",
    download: args.download
  });
  const dongSource = buildSource({
    sourceId: "sgis-bnd-dong-2025-2q",
    title: "SGIS 2025 Q2 administrative dong boundary shapefile",
    sourcePageUrl: SGIS_BOUNDARY_DATA_PAGE_URL,
    downloadUrl: SGIS_BOUNDARY_DOWNLOAD_URL,
    requestMethod: "GET",
    encoding: "utf-8",
    download: args.download
  });

  const sigunguRecords = parseSgisSigunguRecords(sigunguCollection).filter((record) =>
    provinceBySgisCode.has(record.sigunguCode.slice(0, 2))
  );
  const dongRecords = parseSgisDongRecords(dongCollection);
  const sigunguByCode = new Map(sigunguRecords.map((record) => [record.sigunguCode, record] as const));
  const indexedEmdRecords: IndexedEmdRecord[] = [];

  for (const dong of dongRecords) {
    const sigunguCode = dong.emdCode.slice(0, 5);
    const sigungu = sigunguByCode.get(sigunguCode);
    if (!sigungu) {
      throw new Error(`Missing SGIS sigungu lookup for administrative dong ${dong.emdCode}.`);
    }

    const province = findProvinceBySigunguCode(sigungu.sigunguCode);
    indexedEmdRecords.push({
      emdCode: dong.emdCode,
      emdName: dong.emdName,
      sigunguCode: sigungu.sigunguCode,
      officialSigunguCode: sigungu.sigunguCode,
      sigunguName: sigungu.sigunguName,
      provinceName: province.fullName,
      provinceShortName: province.shortName,
      geometry: dong.geometry
    });
  }

  if (indexedEmdRecords.length === 0) {
    throw new Error("Failed to assign any SGIS administrative dong features to South Korea sigungu shapes.");
  }

  return {
    indexedEmdRecords,
    sigunguSource: {
      ...sigunguSource,
      rowCount: sigunguRecords.length
    },
    emdSource: {
      ...dongSource,
      rowCount: indexedEmdRecords.length
    }
  };
}

function parseCsvRows(text: string): string[][] {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(","));
}

export function parseNgiiSigunguCsv(text: string): NgiiSigunguRecord[] {
  const rows = parseCsvRows(text);
  const records: NgiiSigunguRecord[] = [];

  for (const row of rows.slice(1)) {
    const sigunguCode = row[1]?.trim() ?? "";
    const sigunguObjectCode = row[3]?.trim() || null;
    const sigunguName = row[2]?.trim() ?? "";
    if (!sigunguCode || !sigunguName) {
      continue;
    }
    records.push({
      sigunguCode,
      sigunguObjectCode,
      sigunguName
    });
  }

  if (records.length === 0) {
    throw new Error("Failed to parse any sigungu rows from the NGII CSV.");
  }

  return records;
}

function parseWkbHexGeometry(hex: string): GeoJsonGeometry {
  const geometry = wkx.Geometry.parse(Buffer.from(hex, "hex")).toGeoJSON() as {
    type?: string;
  } & Partial<GeoJsonGeometry>;
  if (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon") {
    throw new Error(`Unsupported geometry type "${geometry.type}" in NGII 읍면동 data.`);
  }
  return geometry as GeoJsonGeometry;
}

export function parseNgiiEmdCsv(text: string): NgiiEmdRecord[] {
  const rows = parseCsvRows(text);
  const records: NgiiEmdRecord[] = [];

  for (const row of rows.slice(1)) {
    const emdCode = row[1]?.trim() ?? "";
    const emdName = row[2]?.trim() ?? "";
    const sigunguCode = row[3]?.trim() ?? "";
    const geometryHex = row.slice(5).join(",").trim();
    if (!emdCode || !emdName || !sigunguCode || !geometryHex) {
      continue;
    }
    records.push({
      emdCode,
      emdName,
      sigunguCode,
      geometry: parseWkbHexGeometry(geometryHex)
    });
  }

  if (records.length === 0) {
    throw new Error("Failed to parse any 읍면동 rows from the NGII CSV.");
  }

  return records;
}

function buildIndexedEmdRecords(args: {
  sigunguRecords: NgiiSigunguRecord[];
  emdRecords: NgiiEmdRecord[];
}): IndexedEmdRecord[] {
  const sigunguByAnyCode = new Map<string, NgiiSigunguRecord>();
  for (const record of args.sigunguRecords) {
    sigunguByAnyCode.set(record.sigunguCode, record);
    if (record.sigunguObjectCode) {
      sigunguByAnyCode.set(record.sigunguObjectCode, record);
    }
  }

  return args.emdRecords.map((record) => {
    const province = provinceByOfficialCode.get(record.emdCode.slice(0, 2));
    const sigungu = sigunguByAnyCode.get(record.sigunguCode);
    if (!province) {
      throw new Error(`Unknown province code "${record.emdCode.slice(0, 2)}" for ${record.emdCode}.`);
    }
    if (!sigungu) {
      throw new Error(`Missing sigungu lookup for 읍면동 ${record.emdCode}.`);
    }
    return {
      ...record,
      provinceName: province.fullName,
      provinceShortName: province.shortName,
      officialSigunguCode: sigungu.sigunguCode,
      sigunguName: sigungu.sigunguName
    };
  });
}

function buildSigunguIndex(records: IndexedEmdRecord[]): Map<string, IndexedEmdRecord[]> {
  const index = new Map<string, IndexedEmdRecord[]>();

  for (const record of records) {
    const key = `${record.provinceShortName}|${normalizeAdministrativeNameKey(record.sigunguName)}`;
    const items = index.get(key) ?? [];
    items.push(record);
    index.set(key, items);
  }

  return index;
}

function resolveSigunguRecords(args: {
  provinceShortName: string;
  sigunguName: string;
  sigunguIndex: Map<string, IndexedEmdRecord[]>;
}): IndexedEmdRecord[] {
  const key = `${args.provinceShortName}|${normalizeAdministrativeNameKey(args.sigunguName)}`;
  const records = args.sigunguIndex.get(key);
  if (!records || records.length === 0) {
    throw new Error(
      `Could not resolve sigungu "${args.sigunguName}" in province "${args.provinceShortName}".`
    );
  }
  return records;
}

function resolveEmdRecord(args: {
  provinceShortName: string;
  sigunguName: string;
  emdName: string;
  sigunguIndex: Map<string, IndexedEmdRecord[]>;
}): IndexedEmdRecord {
  const candidates = resolveSigunguRecords(args);
  const prioritizedMatchKeys = buildAdministrativeNameMatchKeys(args.emdName);
  const collapsedSubdivisionKey = buildCollapsedSubdivisionKey(args.emdName);
  const matchKeys = collapsedSubdivisionKey
    ? [...new Set([...prioritizedMatchKeys, collapsedSubdivisionKey])]
    : prioritizedMatchKeys;

  for (const matchKey of matchKeys) {
    const matches = candidates.filter(
      (candidate) => normalizeAdministrativeNameKey(candidate.emdName) === matchKey
    );

    if (matches.length === 1) {
      const match = matches[0];
      if (match) {
        return match;
      }
    }

    if (matches.length > 1) {
      throw new Error(
        `Resolved multiple 읍면동 rows for "${args.sigunguName} ${args.emdName}" in province "${args.provinceShortName}".`
      );
    }
  }

  throw new Error(
    `Could not resolve 읍면동 "${args.sigunguName} ${args.emdName}" in province "${args.provinceShortName}".`
  );
}

function listProvinceSigunguNames(args: {
  provinceShortName: string;
  sigunguIndex: Map<string, IndexedEmdRecord[]>;
}): string[] {
  const prefix = `${args.provinceShortName}|`;
  return [...new Set(
    [...args.sigunguIndex.entries()]
      .filter(([key]) => key.startsWith(prefix))
      .map(([, records]) => records[0]?.sigunguName ?? "")
      .filter(Boolean)
  )];
}

function resolveSigunguPrefixFromToken(args: {
  provinceShortName: string;
  token: string;
  sigunguIndex: Map<string, IndexedEmdRecord[]>;
}): string | null {
  const matches = listProvinceSigunguNames(args)
    .filter((sigunguName) => args.token.startsWith(`${sigunguName} `))
    .sort((left, right) => right.length - left.length);
  return matches[0] ?? null;
}

function inferDefaultSigunguName(args: {
  record: ConstituencyLawRecord;
  sigunguIndex: Map<string, IndexedEmdRecord[]>;
}): string | null {
  const districtKeys = [
    args.record.districtName,
    args.record.districtName.replace(/특별자치시/g, "시").replace(/특별자치도/g, "도")
  ].map((item) => normalizeAdministrativeNameKey(item));
  const provinceSigunguNames = listProvinceSigunguNames({
    provinceShortName: args.record.provinceShortName,
    sigunguIndex: args.sigunguIndex
  });
  const matches = provinceSigunguNames
    .filter((sigunguName) =>
      districtKeys.some((districtKey) =>
        districtKey.startsWith(normalizeAdministrativeNameKey(sigunguName))
      )
    )
    .sort(
      (left, right) =>
        normalizeAdministrativeNameKey(right).length - normalizeAdministrativeNameKey(left).length
    );

  if (matches.length === 0 && provinceSigunguNames.length === 1) {
    return provinceSigunguNames[0] ?? null;
  }

  return matches[0] ?? null;
}

function resolveLawRecordToEmdRecords(args: {
  record: ConstituencyLawRecord;
  sigunguIndex: Map<string, IndexedEmdRecord[]>;
}): IndexedEmdRecord[] {
  const selections = new Map<string, IndexedEmdRecord>();
  let currentSigunguName = "";

  for (const rawToken of args.record.areaText.split(",")) {
    const token = normalizeLawCell(rawToken);
    if (!token) {
      continue;
    }

    if (token.endsWith("일원")) {
      currentSigunguName = token.replace(/\s*일원$/, "").trim();
      for (const item of resolveSigunguRecords({
        provinceShortName: args.record.provinceShortName,
        sigunguName: currentSigunguName,
        sigunguIndex: args.sigunguIndex
      })) {
        selections.set(item.emdCode, item);
      }
      continue;
    }

    const tokenSigunguName = resolveSigunguPrefixFromToken({
      provinceShortName: args.record.provinceShortName,
      token,
      sigunguIndex: args.sigunguIndex
    });
    if (tokenSigunguName) {
      currentSigunguName = tokenSigunguName;
      const emdName = token.slice(tokenSigunguName.length).trim();
      const item = resolveEmdRecord({
        provinceShortName: args.record.provinceShortName,
        sigunguName: currentSigunguName,
        emdName,
        sigunguIndex: args.sigunguIndex
      });
      selections.set(item.emdCode, item);
      continue;
    }

    if (!currentSigunguName) {
      currentSigunguName =
        inferDefaultSigunguName({
          record: args.record,
          sigunguIndex: args.sigunguIndex
        }) ?? "";
    }

    if (!currentSigunguName) {
      throw new Error(`Area token "${token}" in ${args.record.lawDistrictName} did not declare a sigungu context.`);
    }

    const item = resolveEmdRecord({
      provinceShortName: args.record.provinceShortName,
      sigunguName: currentSigunguName,
      emdName: token,
      sigunguIndex: args.sigunguIndex
    });
    selections.set(item.emdCode, item);
  }

  return [...selections.values()].sort((left, right) => left.emdCode.localeCompare(right.emdCode));
}

function buildTopology(records: IndexedEmdRecord[]): {
  topology: Topology;
  geometryByEmdCode: Map<string, TopologyGeometry>;
} {
  const featureCollection: GeoJsonFeatureCollection = {
    type: "FeatureCollection",
    features: records.map((record) => ({
      type: "Feature",
      id: record.emdCode,
      properties: {
        emdCode: record.emdCode
      },
      geometry: record.geometry
    }))
  };

  const topology = topojsonServer.topology({
    emd: featureCollection
  });
  const object = topology.objects.emd;
  if (!object || object.type !== "GeometryCollection") {
    throw new Error("Failed to construct a TopoJSON geometry collection for 읍면동 boundaries.");
  }

  const geometryByEmdCode = new Map<string, TopologyGeometry>();
  for (const geometry of object.geometries) {
    const emdCode =
      typeof geometry.id === "string"
        ? geometry.id
        : typeof geometry.properties?.emdCode === "string"
          ? geometry.properties.emdCode
          : "";
    if (!emdCode) {
      throw new Error("Encountered a TopoJSON geometry without an 읍면동 code.");
    }
    geometryByEmdCode.set(emdCode, geometry);
  }

  return {
    topology,
    geometryByEmdCode
  };
}

function buildConstituencyFeatures(args: {
  lawRecords: ConstituencyLawRecord[];
  indexedEmdRecords: IndexedEmdRecord[];
}): ConstituencyBoundaryFeature[] {
  const sigunguIndex = buildSigunguIndex(args.indexedEmdRecords);
  const { topology, geometryByEmdCode } = buildTopology(args.indexedEmdRecords);

  return args.lawRecords.map((record) => {
    const province = provinceByFullName.get(record.provinceName);
    if (!province) {
      throw new Error(`Unknown province name "${record.provinceName}" in law parser output.`);
    }

    const emdRecords = resolveLawRecordToEmdRecords({
      record,
      sigunguIndex
    });
    const topologyGeometries = emdRecords.map((item) => {
      const geometry = geometryByEmdCode.get(item.emdCode);
      if (!geometry) {
        throw new Error(`Missing TopoJSON geometry for 읍면동 ${item.emdCode}.`);
      }
      return geometry;
    });
    const geometry = topojsonClient.merge(topology, topologyGeometries);
    const memberDistrictLabel = buildMemberDistrictLabel(province, record.districtName);
    const memberDistrictKey = normalizeAdministrativeNameKey(memberDistrictLabel);
    const sigunguCodes = [...new Set(emdRecords.map((item) => item.sigunguCode))].sort();
    const officialSigunguCodes = [...new Set(emdRecords.map((item) => item.officialSigunguCode))].sort();
    const sigunguNames = [...new Set(emdRecords.map((item) => item.sigunguName))].sort((left, right) =>
      left.localeCompare(right, "ko")
    );
    const emdCodes = emdRecords.map((item) => item.emdCode);
    const emdNames = emdRecords.map((item) => item.emdName);

    return {
      type: "Feature",
      properties: {
        constituencyId: memberDistrictKey,
        lawDistrictName: record.lawDistrictName,
        districtName: record.districtName,
        memberDistrictLabel,
        memberDistrictKey,
        provinceName: province.fullName,
        provinceShortName: province.shortName,
        areaText: record.areaText,
        aliases: buildDistrictAliases(province, record.districtName),
        sigunguCodes: officialSigunguCodes.length > 0 ? officialSigunguCodes : sigunguCodes,
        sigunguNames,
        emdCodes,
        emdNames
      },
      geometry
    };
  });
}

export function buildConstituencyBoundaryExport(args: {
  generatedAt: string;
  lawEffectiveDate: string;
  lawSourceUrl: string;
  lawText: string;
  lawSource: ConstituencyBoundarySource;
  sigunguCsv: string;
  sigunguSource: ConstituencyBoundarySource;
  emdCsv: string;
  emdSource: ConstituencyBoundarySource;
}): ConstituencyBoundaryExport {
  const lawRecords = parseConstituencyLawText(args.lawText);
  const sigunguRecords = parseNgiiSigunguCsv(args.sigunguCsv);
  const emdRecords = parseNgiiEmdCsv(args.emdCsv);
  const indexedEmdRecords = buildIndexedEmdRecords({
    sigunguRecords,
    emdRecords
  });

  return {
    type: "FeatureCollection",
    generatedAt: args.generatedAt,
    lawEffectiveDate: args.lawEffectiveDate,
    lawSourceUrl: args.lawSourceUrl,
    sources: [
      {
        ...args.lawSource,
        rowCount: lawRecords.length
      },
      {
        ...args.sigunguSource,
        rowCount: sigunguRecords.length
      },
      {
        ...args.emdSource,
        rowCount: emdRecords.length
      }
    ],
    features: buildConstituencyFeatures({
      lawRecords,
      indexedEmdRecords
    })
  };
}

export function buildConstituencyBoundaryExportFromRecords(args: {
  generatedAt: string;
  lawEffectiveDate: string;
  lawSourceUrl: string;
  lawRecords: ConstituencyLawRecord[];
  lawSource: ConstituencyBoundarySource;
  indexedEmdRecords: IndexedEmdRecord[];
  sigunguSource: ConstituencyBoundarySource;
  emdSource: ConstituencyBoundarySource;
}): ConstituencyBoundaryExport {
  return {
    type: "FeatureCollection",
    generatedAt: args.generatedAt,
    lawEffectiveDate: args.lawEffectiveDate,
    lawSourceUrl: args.lawSourceUrl,
    sources: [
      {
        ...args.lawSource,
        rowCount: args.lawRecords.length
      },
      args.sigunguSource,
      args.emdSource
    ],
    features: buildConstituencyFeatures({
      lawRecords: args.lawRecords,
      indexedEmdRecords: args.indexedEmdRecords
    })
  };
}

async function fetchBufferWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<DownloadedSource> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
  const retrievedAt = new Date().toISOString();

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }

    return {
      content: Buffer.from(await response.arrayBuffer()),
      retrievedAt
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.message.includes("aborted"))
    ) {
      throw new Error(`Request timed out for ${url} after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function decodeCp949Csv(buffer: Buffer): string {
  return iconv.decode(buffer, "cp949");
}

function buildSource(args: {
  sourceId: string;
  title: string;
  sourcePageUrl?: string;
  downloadUrl: string;
  requestMethod?: "GET" | "POST";
  requestBody?: string;
  encoding?: string;
  download: DownloadedSource;
}): ConstituencyBoundarySource {
  return {
    sourceId: args.sourceId,
    title: args.title,
    sourcePageUrl: args.sourcePageUrl,
    downloadUrl: args.downloadUrl,
    requestMethod: args.requestMethod,
    requestBody: args.requestBody,
    encoding: args.encoding,
    checksumSha256: sha256Buffer(args.download.content),
    retrievedAt: args.download.retrievedAt
  };
}

export async function fetchOfficialConstituencyBoundaryInputs(args?: {
  timeoutMs?: number;
}): Promise<{
  law: DownloadedTextSource;
  boundaryBundle: DownloadedBoundaryBundle;
}> {
  const timeoutMs = args?.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const [lawDownload, sgisBoundaryDownload] = await Promise.all([
    fetchBufferWithTimeout(
      CONSTITUENCY_LAW_DOWNLOAD_URL,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "user-agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        },
        body: CONSTITUENCY_LAW_DOWNLOAD_BODY
      },
      timeoutMs
    ),
    fetchBufferWithTimeout(
      SGIS_BOUNDARY_DOWNLOAD_URL,
      {
        headers: {
          "user-agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        }
      },
      timeoutMs
    )
  ]);

  return {
    law: {
      text: lawDownload.content.toString("utf8"),
      source: buildSource({
        sourceId: "law-go-kr-public-official-election-act-bylaw-1",
        title: "공직선거법 별표 1 국회의원지역선거구구역표",
        sourcePageUrl: CONSTITUENCY_LAW_PAGE_URL,
        downloadUrl: CONSTITUENCY_LAW_DOWNLOAD_URL,
        requestMethod: "POST",
        requestBody: CONSTITUENCY_LAW_DOWNLOAD_BODY,
        encoding: "utf-8",
        download: lawDownload
      })
    },
    boundaryBundle: await loadSgisBoundaryBundle({
      download: sgisBoundaryDownload
    })
  };
}
