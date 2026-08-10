import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Resvg } from "@resvg/resvg-js";

const DEFAULT_APP_BASE_URL = "https://kuil09.github.io/lawmaker-monitor/";
const DEFAULT_DATA_REPO_BASE_URL =
  "https://kuil09.github.io/lawmaker-monitor-data/";
const DEFAULT_DIST_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../apps/web/dist"
);
const DEFAULT_FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_CARD_FONT_FILES = [
  "400Regular/NotoSansKR_400Regular.ttf",
  "700Bold/NotoSansKR_700Bold.ttf",
  "900Black/NotoSansKR_900Black.ttf"
].map((fontPath) =>
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    `../node_modules/@expo-google-fonts/noto-sans-kr/${fontPath}`
  )
);
const CARD_GENERATION_CONCURRENCY = 2;
const CARD_RENDERER_VERSION = "member-share-card-v7-unresolved-vote-coverage";
const MEMBER_CARD_PALETTE = Object.freeze({
  paper: "#e7e7e1",
  paperDeep: "#c9cac4",
  ink: "#23241f",
  inkSoft: "#5f615a",
  rule: "#7d7f77",
  ruleSoft: "#bfc0ba",
  panel: "#454741",
  lime: "#d8f33f",
  limeDark: "#5b6c00"
});
const STATEMENT_FETCH_CONCURRENCY = 16;
const SAFE_MEMBER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const GA_MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]+$/;
const ANALYTICS_CONSENT_STORAGE_KEY = "lawmaker-monitor.analytics-consent.v1";
const PORTRAIT_FETCH_ATTEMPTS = 3;
const ASSEMBLY_PORTRAIT_CIRCUIT_FAILURE_THRESHOLD = 2;
const PORTRAIT_RETRY_BASE_DELAY_MS = 250;
const PORTRAIT_RETRY_MAX_DELAY_MS = 2_000;
const ASSEMBLY_ORIGIN = "https://www.assembly.go.kr";
const ASSEMBLY_PORTRAIT_PREFIX = "/static/portal/img/openassm/new/";
const ASSEMBLY_PORTRAIT_THUMB_PREFIX = `${ASSEMBLY_PORTRAIT_PREFIX}thumb/`;
const ASSEMBLY_REQUEST_HEADERS = {
  Accept:
    "text/html,application/xhtml+xml,image/avif,image/webp,image/png,image/jpeg,*/*",
  Referer: `${ASSEMBLY_ORIGIN}/`,
  "User-Agent":
    "Mozilla/5.0 (compatible; LawmakerMonitor/1.0; +https://kuil09.github.io/lawmaker-monitor/)"
};

function normalizeBaseUrl(value) {
  const normalized = value.trim();
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function normalizeOptionalBaseUrl(value, fallback) {
  return value?.trim() ? normalizeBaseUrl(value) : fallback;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeXml(value) {
  return escapeHtml(value);
}

function serializeScriptValue(value) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

function renderGoogleAnalyticsTag(measurementId, canonicalUrl) {
  const normalizedMeasurementId = measurementId?.trim().toUpperCase() ?? "";
  if (!GA_MEASUREMENT_ID_PATTERN.test(normalizedMeasurementId)) {
    return "";
  }

  const hostname = new URL(canonicalUrl).hostname.toLowerCase();
  const encodedMeasurementId = encodeURIComponent(normalizedMeasurementId);

  return `    <script async src="https://www.googletagmanager.com/gtag/js?id=${encodedMeasurementId}" data-lawmaker-monitor-analytics="${normalizedMeasurementId}"></script>
    <script>
      if (window.location.hostname.toLowerCase() === ${serializeScriptValue(hostname)}) {
        window.dataLayer = window.dataLayer || [];
        window.gtag = window.gtag || function () {
          window.dataLayer.push(arguments);
        };
        var analyticsStorage = "denied";
        try {
          if (window.localStorage.getItem(${serializeScriptValue(ANALYTICS_CONSENT_STORAGE_KEY)}) === "granted") {
            analyticsStorage = "granted";
          }
        } catch (error) {
          analyticsStorage = "denied";
        }
        window.gtag("consent", "default", {
          ad_personalization: "denied",
          ad_storage: "denied",
          ad_user_data: "denied",
          analytics_storage: analyticsStorage
        });
        window.gtag("js", new Date());
        window.gtag("config", ${serializeScriptValue(normalizedMeasurementId)}, {
          allow_ad_personalization_signals: false,
          allow_google_signals: false,
          send_page_view: false
        });
      }
    </script>`;
}

function formatInteger(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
}

function formatRatePercent(value) {
  return `${new Intl.NumberFormat("ko-KR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(value * 100)}%`;
}

function getVoteParticipation(accountability) {
  const totalCount = Math.max(0, accountability.totalRecordedVotes);
  const unresolvedCount = Math.min(
    totalCount,
    Math.max(0, accountability.unresolvedCount ?? 0)
  );
  const resolvedCount = Math.max(0, totalCount - unresolvedCount);
  const participatedCount = Math.max(
    0,
    resolvedCount - accountability.absentCount
  );

  return {
    totalCount,
    resolvedCount,
    unresolvedCount,
    participatedCount,
    rate: resolvedCount > 0 ? participatedCount / resolvedCount : null
  };
}

function formatAssetEok(value) {
  return `${new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 1
  }).format(value / 100_000)}억원`;
}

function formatDate(value) {
  const parsedDate = new Date(value);
  if (Number.isNaN(parsedDate.getTime())) {
    return value.slice(0, 10);
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Seoul"
  }).format(parsedDate);
}

function truncate(value, maxLength) {
  if (!value || value.length <= maxLength) {
    return value ?? "";
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function resolveAppBaseUrl(env) {
  if (env.APP_BASE_URL?.trim()) {
    return normalizeBaseUrl(env.APP_BASE_URL);
  }

  if (env.PAGES_BASE_PATH?.trim()) {
    const origin = normalizeBaseUrl(
      env.GITHUB_PAGES_ORIGIN?.trim() || "https://kuil09.github.io"
    );
    const basePath = `${env.PAGES_BASE_PATH.replace(/^\/+|\/+$/g, "")}/`;
    return new URL(basePath, origin).toString();
  }

  return DEFAULT_APP_BASE_URL;
}

async function fetchOptionalJson(fetchImpl, url, warnings, timeoutMs) {
  try {
    const response = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      warnings.push(`${url} returned ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    warnings.push(
      `${url} could not be loaded: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

function isAssemblyUrl(url) {
  try {
    return new URL(url).origin === ASSEMBLY_ORIGIN;
  } catch {
    return false;
  }
}

function getOptimizedPortraitUrl(url) {
  try {
    const parsedUrl = new URL(url);
    if (
      parsedUrl.origin !== ASSEMBLY_ORIGIN ||
      !parsedUrl.pathname.startsWith(ASSEMBLY_PORTRAIT_PREFIX) ||
      parsedUrl.pathname.startsWith(ASSEMBLY_PORTRAIT_THUMB_PREFIX)
    ) {
      return url;
    }

    parsedUrl.pathname = `${ASSEMBLY_PORTRAIT_THUMB_PREFIX}${parsedUrl.pathname.slice(
      ASSEMBLY_PORTRAIT_PREFIX.length
    )}`;
    return parsedUrl.toString();
  } catch {
    return url;
  }
}

function isRetryableResponse(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

class AssemblyPortraitCircuitOpenError extends Error {
  constructor() {
    super("[member-share] Assembly portrait circuit is open");
    this.name = "AssemblyPortraitCircuitOpenError";
  }
}

export function createAssemblyPortraitCircuit({
  failureThreshold = ASSEMBLY_PORTRAIT_CIRCUIT_FAILURE_THRESHOLD,
  onOpen
} = {}) {
  let consecutiveFailures = 0;
  let open = false;

  return {
    assertAvailable() {
      if (open) {
        throw new AssemblyPortraitCircuitOpenError();
      }
    },
    recordFailure() {
      if (open) {
        return;
      }

      consecutiveFailures += 1;
      if (consecutiveFailures >= failureThreshold) {
        open = true;
        onOpen?.();
      }
    },
    recordSuccess() {
      consecutiveFailures = 0;
    }
  };
}

function readRetryAfterMs(response) {
  const retryAfter = response.headers.get("retry-after");
  if (!retryAfter) {
    return null;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const retryAt = Date.parse(retryAfter);
  return Number.isNaN(retryAt) ? null : Math.max(0, retryAt - Date.now());
}

function getPortraitRetryDelayMs(response, attempt) {
  return Math.min(
    readRetryAfterMs(response) ?? PORTRAIT_RETRY_BASE_DELAY_MS * 2 ** attempt,
    PORTRAIT_RETRY_MAX_DELAY_MS
  );
}

async function waitForRetry(delayMs) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
}

async function fetchPortraitResource(
  fetchImpl,
  url,
  headers,
  timeoutMs,
  assemblyPortraitCircuit
) {
  let lastError = null;
  const usesAssemblyCircuit = assemblyPortraitCircuit && isAssemblyUrl(url);

  if (usesAssemblyCircuit) {
    assemblyPortraitCircuit.assertAvailable();
  }

  for (let attempt = 0; attempt < PORTRAIT_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (
        !isRetryableResponse(response.status) ||
        attempt === PORTRAIT_FETCH_ATTEMPTS - 1
      ) {
        if (usesAssemblyCircuit) {
          if (isRetryableResponse(response.status)) {
            assemblyPortraitCircuit.recordFailure();
          } else {
            assemblyPortraitCircuit.recordSuccess();
          }
        }
        return response;
      }

      lastError = new Error(`returned ${response.status}`);
      await waitForRetry(getPortraitRetryDelayMs(response, attempt));
    } catch (error) {
      lastError = error;
      if (attempt === PORTRAIT_FETCH_ATTEMPTS - 1) {
        break;
      }
      await waitForRetry(PORTRAIT_RETRY_BASE_DELAY_MS * 2 ** attempt);
    }
  }

  if (usesAssemblyCircuit) {
    assemblyPortraitCircuit.recordFailure();
  }
  throw lastError ?? new Error("portrait request failed");
}

async function fetchImageDataUrl(
  fetchImpl,
  url,
  warnings,
  timeoutMs,
  assemblyPortraitCircuit
) {
  const optimizedUrl = getOptimizedPortraitUrl(url);

  try {
    const response = await fetchPortraitResource(
      fetchImpl,
      optimizedUrl,
      isAssemblyUrl(optimizedUrl) ? ASSEMBLY_REQUEST_HEADERS : undefined,
      timeoutMs,
      assemblyPortraitCircuit
    );
    if (!response.ok) {
      warnings.push(`${optimizedUrl} image returned ${response.status}`);
      return null;
    }

    const contentType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      ?.toLowerCase();
    if (!contentType?.startsWith("image/")) {
      warnings.push(
        `${optimizedUrl} returned non-image content type ${
          contentType ?? "unknown"
        }`
      );
      return null;
    }

    const image = Buffer.from(await response.arrayBuffer());
    if (image.length === 0) {
      warnings.push(`${optimizedUrl} returned an empty image`);
      return null;
    }

    return `data:${contentType};base64,${image.toString("base64")}`;
  } catch (error) {
    if (error instanceof AssemblyPortraitCircuitOpenError) {
      return null;
    }
    warnings.push(
      `${optimizedUrl} image could not be loaded: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

export async function fetchPublishedMemberCardPng({
  fetchImpl,
  url,
  warnings,
  timeoutMs
}) {
  try {
    const response = await fetchPortraitResource(
      fetchImpl,
      url,
      undefined,
      timeoutMs
    );
    if (!response.ok) {
      warnings.push(`${url} existing card returned ${response.status}`);
      return null;
    }

    const contentType = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      ?.toLowerCase();
    if (contentType !== "image/png") {
      warnings.push(
        `${url} existing card returned non-PNG content type ${
          contentType ?? "unknown"
        }`
      );
      return null;
    }

    const image = Buffer.from(await response.arrayBuffer());
    if (image.length === 0) {
      warnings.push(`${url} existing card returned an empty image`);
      return null;
    }

    return image;
  } catch (error) {
    warnings.push(
      `${url} existing card could not be loaded: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return null;
  }
}

export function extractOfficialMemberPhotoUrl(html, pageUrl = ASSEMBLY_ORIGIN) {
  const match = html.match(
    /background-image\s*:\s*url\(\s*(['"]?)(\/static\/portal\/img\/openassm\/[^'")\s]+)\1\s*\)/i
  );

  return match?.[2] ? new URL(match[2], pageUrl).toString() : null;
}

function buildOfficialMemberPageUrl(memberId, assemblyNo) {
  const url = new URL("/portal/assm/assmMemb/member.do", ASSEMBLY_ORIGIN);
  url.search = new URLSearchParams({
    monaCd: memberId,
    st: String(assemblyNo),
    viewType: "CONTBODY"
  }).toString();
  return url.toString();
}

export async function resolveMemberPortraitDataUrl({
  member,
  assemblyNo,
  fetchImpl,
  warnings,
  timeoutMs,
  assemblyPortraitCircuit
}) {
  if (member.photoUrl) {
    const publishedPhoto = await fetchImageDataUrl(
      fetchImpl,
      member.photoUrl,
      warnings,
      timeoutMs,
      assemblyPortraitCircuit
    );
    if (publishedPhoto) {
      return publishedPhoto;
    }
  }

  const memberPageUrl = buildOfficialMemberPageUrl(member.memberId, assemblyNo);
  let officialPhotoUrl = null;

  try {
    const response = await fetchPortraitResource(
      fetchImpl,
      memberPageUrl,
      ASSEMBLY_REQUEST_HEADERS,
      timeoutMs,
      assemblyPortraitCircuit
    );
    if (!response.ok) {
      warnings.push(`${memberPageUrl} returned ${response.status}`);
    } else {
      officialPhotoUrl = extractOfficialMemberPhotoUrl(
        await response.text(),
        memberPageUrl
      );
      if (!officialPhotoUrl) {
        warnings.push(`${memberPageUrl} did not contain a member portrait`);
      }
    }
  } catch (error) {
    if (error instanceof AssemblyPortraitCircuitOpenError) {
      throw error;
    }
    warnings.push(
      `${memberPageUrl} could not be loaded: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (officialPhotoUrl) {
    const officialPhoto = await fetchImageDataUrl(
      fetchImpl,
      officialPhotoUrl,
      warnings,
      timeoutMs,
      assemblyPortraitCircuit
    );
    if (officialPhoto) {
      return officialPhoto;
    }
  }

  throw new Error(
    `[member-share] a verified portrait is required for ${member.name} (${member.memberId})`
  );
}

async function runInBatches(items, batchSize, callback) {
  for (let itemIndex = 0; itemIndex < items.length; itemIndex += batchSize) {
    await Promise.all(
      items.slice(itemIndex, itemIndex + batchSize).map(callback)
    );
  }
}

function getExportPath(manifest, exportKey, fallbackPath) {
  const configuredPath = manifest?.exports?.[exportKey]?.path;
  return typeof configuredPath === "string" && configuredPath
    ? configuredPath
    : fallbackPath;
}

function mergeIdentity(target, source) {
  if (!source || typeof source !== "object") {
    return;
  }

  for (const field of [
    "name",
    "party",
    "district",
    "photoUrl",
    "officialProfileUrl"
  ]) {
    if (
      (target[field] === undefined || target[field] === null) &&
      source[field] !== undefined &&
      source[field] !== null
    ) {
      target[field] = source[field];
    }
  }
}

export function mergeMemberShareSources({
  activityCalendar,
  accountabilitySummary,
  memberAssetsIndex,
  billProposalActivity,
  memberStatementSummaries = new Map()
}) {
  const membersById = new Map();

  const getOrCreate = (source) => {
    if (
      !source?.memberId ||
      !source?.name ||
      !SAFE_MEMBER_ID_PATTERN.test(source.memberId)
    ) {
      return null;
    }

    const existing = membersById.get(source.memberId) ?? {
      memberId: source.memberId
    };
    mergeIdentity(existing, source);
    membersById.set(source.memberId, existing);
    return existing;
  };

  for (const activity of activityCalendar?.assembly?.members ?? []) {
    const member = getOrCreate(activity);
    if (member) {
      member.activity = activity;
    }
  }

  for (const accountability of accountabilitySummary?.items ?? []) {
    const member = getOrCreate(accountability);
    if (member) {
      member.accountability = accountability;
    }
  }

  for (const assets of memberAssetsIndex?.members ?? []) {
    const member = getOrCreate(assets);
    if (member) {
      member.assets = assets;
    }
  }

  for (const bills of billProposalActivity?.items ?? []) {
    const member = getOrCreate(bills);
    if (member) {
      member.bills = bills;
    }
  }

  for (const [memberId, statements] of memberStatementSummaries) {
    const member = membersById.get(memberId);
    if (member) {
      member.statements = statements;
    }
  }

  return [...membersById.values()]
    .filter((member) => member.memberId && member.name)
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, "ko-KR") ||
        left.memberId.localeCompare(right.memberId)
    );
}

function buildEvidenceFacts(member) {
  const facts = [];

  if (member.accountability) {
    const participation = getVoteParticipation(member.accountability);
    facts.push(
      participation.rate === null
        ? participation.totalCount > 0
          ? `기록표결 ${formatInteger(
              participation.totalCount
            )}건 · 의원별 표결행 ${formatInteger(
              participation.unresolvedCount
            )}건 확인 불가`
          : "공개 기록표결 자료 없음"
        : `확인된 기록표결 ${formatInteger(
            participation.resolvedCount
          )}건 중 ${formatInteger(participation.participatedCount)}건 참여${
            participation.unresolvedCount > 0
              ? ` · 확인 불가 ${formatInteger(participation.unresolvedCount)}건`
              : ""
          }`
    );
  } else if (member.activity?.voteRecordCount !== undefined) {
    facts.push(
      `공개된 표결 기록 ${formatInteger(member.activity.voteRecordCount)}건`
    );
  }

  if (member.bills) {
    const outcomeText =
      member.bills.leadResultAvailableProposalCount > 0
        ? ` · 처리결과 확인 ${formatInteger(
            member.bills.leadResultAvailableProposalCount
          )}건`
        : "";
    facts.push(
      `대표발의 ${formatInteger(member.bills.leadProposalCount)}건${outcomeText}`
    );
  }

  if (member.assets) {
    facts.push(
      `최근 공개 순재산 ${formatAssetEok(member.assets.latestTotal)} (${formatDate(
        member.assets.latestDisclosureDate
      )})`
    );
  }

  if (facts.length < 3 && member.accountability) {
    facts.push(
      `정당 다수 의견과 다른 표결 ${formatInteger(
        member.accountability.partyLineDefectionCount
      )}건 / 비교 가능 ${formatInteger(
        member.accountability.partyLineParticipationCount
      )}건`
    );
  }

  return facts.slice(0, 3);
}

function buildPerformanceHighlights(member) {
  const highlights = [];

  if (member.accountability) {
    const participation = getVoteParticipation(member.accountability);
    highlights.push({
      label: "확인된 표결 참여율",
      value:
        participation.rate === null
          ? "산정 불가"
          : formatRatePercent(participation.rate),
      contextLabel: "의원별 표결행",
      contextValue:
        participation.rate === null
          ? participation.totalCount > 0
            ? `확인 불가 ${formatInteger(
                participation.unresolvedCount
              )} / ${formatInteger(participation.totalCount)}건`
            : "자료 없음"
          : `${formatInteger(participation.participatedCount)} / ${formatInteger(
              participation.resolvedCount
            )}건${
              participation.unresolvedCount > 0
                ? ` · 미확인 ${formatInteger(participation.unresolvedCount)}건`
                : ""
            }`
    });
  } else if (member.activity?.voteRecordCount !== undefined) {
    highlights.push({
      label: "공개 표결",
      value: `${formatInteger(member.activity.voteRecordCount)}건`,
      contextLabel: "공개 기록",
      contextValue: "확인"
    });
  }

  if (member.bills) {
    highlights.push({
      label: "대표발의",
      value: `${formatInteger(member.bills.leadProposalCount)}건`,
      contextLabel: "처리결과 확인",
      contextValue: `${formatInteger(
        member.bills.leadResultAvailableProposalCount
      )}건`
    });
  }

  return highlights.slice(0, 2);
}

export function buildMemberCardModel(member, context) {
  const encodedMemberId = encodeURIComponent(member.memberId);
  const canonicalUrl = new URL(
    `members/${encodedMemberId}/`,
    context.appBaseUrl
  ).toString();
  const imageUrl = new URL(
    `member-cards/${encodedMemberId}.png?v=${encodeURIComponent(
      context.cardVersion ?? context.snapshotId
    )}`,
    context.appBaseUrl
  ).toString();
  const activityUrl = new URL(
    `#calendar?member=${encodedMemberId}`,
    context.appBaseUrl
  ).toString();
  const affiliation = [member.party, member.district]
    .filter(Boolean)
    .join(" · ");
  const facts = buildEvidenceFacts(member);
  const highlights = buildPerformanceHighlights(member);
  const tertiaryFact =
    facts.find((fact) => fact.startsWith("최근 공개")) ??
    facts.find(
      (fact) =>
        !fact.includes("기록표결") &&
        !fact.includes("대표발의") &&
        !fact.includes("공개된 표결 기록")
    ) ??
    null;
  const latestStatement = [...(member.statements?.summaries ?? [])].sort(
    (left, right) =>
      String(right.meetingDate ?? "").localeCompare(
        String(left.meetingDate ?? "")
      )
  )[0];
  const latestEvidenceHeadline = latestStatement
    ? truncate(
        `${formatDate(latestStatement.meetingDate)} · ${
          latestStatement.agendaTitle || latestStatement.meetingTitle
        }`,
        48
      )
    : null;
  const title = `${member.name} 의원 기록 카드`;
  const description = `${affiliation ? `${affiliation} · ` : ""}${
    facts[0] ?? "공식 국회 기록을 확인하세요."
  }${
    latestEvidenceHeadline
      ? ` · 최근 회의록 안건 ${latestEvidenceHeadline}`
      : ""
  }`;

  return {
    memberId: member.memberId,
    encodedMemberId,
    name: member.name,
    party: member.party ?? "소속 정당 미확인",
    district: member.district ?? "선출 유형 미확인",
    photoUrl: member.photoUrl ?? null,
    assemblyLabel: context.assemblyLabel,
    generatedAt: context.generatedAt,
    snapshotId: context.snapshotId,
    canonicalUrl,
    imageUrl,
    activityUrl,
    title,
    description,
    facts,
    highlights,
    tertiaryFact,
    latestEvidenceHeadline
  };
}

export function renderMemberCardSvg(model) {
  if (!model.photoUrl) {
    throw new Error(
      `[member-share] a portrait is required to render ${model.name} (${model.memberId})`
    );
  }

  const highlights = model.highlights ?? [];
  const accessibleDescription = [model.description, ...model.facts.slice(1)]
    .filter(Boolean)
    .join(" · ");
  const nameFontSize =
    model.name.length <= 3 ? 82 : model.name.length <= 4 ? 72 : 62;
  const photo = `<image href="${escapeXml(
    model.photoUrl
  )}" x="14" y="-4" width="460" height="628" preserveAspectRatio="xMidYMid slice" clip-path="url(#portraitClip)" filter="url(#newsprint)" />`;
  const metricColumns = [
    { x: 490, width: 300, highlight: highlights[0] },
    { x: 830, width: 300, highlight: highlights[1] }
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(model.title)}</title>
  <desc id="description">${escapeXml(accessibleDescription)}</desc>
  <defs>
    <pattern id="paper" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.65" fill="${MEMBER_CARD_PALETTE.ink}" opacity="0.09" />
    </pattern>
    <pattern id="halftone" width="7" height="7" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.15" fill="${MEMBER_CARD_PALETTE.ink}" opacity="0.38" />
    </pattern>
    <clipPath id="portraitClip"><rect x="44" y="36" width="400" height="548" /></clipPath>
    <filter id="newsprint">
      <feColorMatrix type="saturate" values="0" />
      <feComponentTransfer>
        <feFuncR type="linear" slope="1.18" intercept="-0.04" />
        <feFuncG type="linear" slope="1.18" intercept="-0.04" />
        <feFuncB type="linear" slope="1.18" intercept="-0.04" />
      </feComponentTransfer>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="${MEMBER_CARD_PALETTE.paper}" />
  <rect width="1200" height="630" fill="url(#paper)" />
  <rect x="22" y="20" width="1156" height="590" fill="none" stroke="${MEMBER_CARD_PALETTE.ink}" stroke-width="2" />
  <rect x="22" y="20" width="1156" height="6" fill="${MEMBER_CARD_PALETTE.lime}" />
  <rect x="44" y="36" width="400" height="548" fill="${MEMBER_CARD_PALETTE.paperDeep}" />
  ${photo}
  <rect x="44" y="36" width="400" height="548" fill="url(#halftone)" opacity="0.3" />
  <rect x="470" y="46" width="190" height="64" fill="${MEMBER_CARD_PALETTE.ink}" />
  <rect x="470" y="104" width="190" height="6" fill="${MEMBER_CARD_PALETTE.lime}" />
  <text x="565" y="91" text-anchor="middle" fill="${MEMBER_CARD_PALETTE.lime}" font-size="40" font-weight="900" font-family="Noto Sans KR">국회 출석부</text>
  <text x="682" y="88" fill="${MEMBER_CARD_PALETTE.ink}" font-size="27" font-weight="900" font-family="Noto Sans KR">의원 실적 카드</text>
  <text x="1130" y="88" text-anchor="end" fill="${MEMBER_CARD_PALETTE.inkSoft}" font-size="20" font-weight="700" font-family="Noto Sans KR">${escapeXml(
    model.assemblyLabel
  )}</text>
  <line x1="470" y1="128" x2="1130" y2="128" stroke="${MEMBER_CARD_PALETTE.ink}" stroke-width="2" />
  <text x="470" y="218" fill="${MEMBER_CARD_PALETTE.ink}" font-size="${nameFontSize}" font-weight="900" font-family="Noto Sans KR">${escapeXml(
    model.name
  )}</text>
  <text x="1130" y="174" text-anchor="end" fill="${MEMBER_CARD_PALETTE.inkSoft}" font-size="22" font-weight="800" font-family="Noto Sans KR">${escapeXml(
    truncate(`${model.party} · ${model.district}`, 42)
  )}</text>
  <line x1="470" y1="258" x2="1130" y2="258" stroke="${MEMBER_CARD_PALETTE.rule}" stroke-width="1" />
  ${metricColumns
    .filter(({ highlight }) => highlight)
    .map(
      ({ x, width, highlight }) => `<g transform="translate(${x} 0)">
    <rect x="0" y="286" width="${width}" height="38" fill="${MEMBER_CARD_PALETTE.panel}" />
    <rect x="0" y="320" width="${width}" height="4" fill="${MEMBER_CARD_PALETTE.lime}" />
    <text x="16" y="313" fill="${MEMBER_CARD_PALETTE.paper}" font-size="21" font-weight="900" font-family="Noto Sans KR">${escapeXml(
      highlight.label
    )}</text>
    <text x="0" y="406" fill="${MEMBER_CARD_PALETTE.ink}" font-size="79" font-weight="900" font-family="Noto Sans KR">${escapeXml(
      highlight.value
    )}</text>
    <text x="0" y="448" fill="${MEMBER_CARD_PALETTE.inkSoft}" font-size="20" font-weight="700" font-family="Noto Sans KR">${escapeXml(
      highlight.contextLabel
    )}</text>
    <text x="${width}" y="448" text-anchor="end" fill="${MEMBER_CARD_PALETTE.limeDark}" font-size="27" font-weight="900" font-family="Noto Sans KR">${escapeXml(
      highlight.contextValue
    )}</text>
  </g>`
    )
    .join("\n  ")}
  <line x1="810" y1="286" x2="810" y2="460" stroke="${MEMBER_CARD_PALETTE.ruleSoft}" stroke-width="1" />
  ${
    model.tertiaryFact
      ? `<text x="470" y="516" fill="${MEMBER_CARD_PALETTE.inkSoft}" font-size="18" font-weight="700" font-family="Noto Sans KR">최근 공개</text>
  <text x="1130" y="516" text-anchor="end" fill="${MEMBER_CARD_PALETTE.ink}" font-size="24" font-weight="900" font-family="Noto Sans KR">${escapeXml(
    truncate(model.tertiaryFact.replace(/^최근 공개 /, ""), 38)
  )}</text>`
      : ""
  }
  <text x="470" y="554" fill="${MEMBER_CARD_PALETTE.inkSoft}" font-size="16" font-weight="700" font-family="Noto Sans KR">수집 기준 ${escapeXml(
    formatDate(model.generatedAt)
  )}</text>
  <text x="1130" y="554" text-anchor="end" fill="${MEMBER_CARD_PALETTE.inkSoft}" font-size="16" font-weight="700" font-family="Noto Sans KR">분모·기간·공식 근거는 상세 화면에서 확인하세요.</text>
  <rect x="0" y="582" width="1200" height="48" fill="${MEMBER_CARD_PALETTE.ink}" />
    <text x="44" y="614" fill="${MEMBER_CARD_PALETTE.lime}" font-size="18" font-weight="800" font-family="Noto Sans KR">국회 출석부 · 공식 공개자료 기반</text>
  <text x="1156" y="614" text-anchor="end" fill="${MEMBER_CARD_PALETTE.paper}" font-size="18" font-weight="700" font-family="Noto Sans KR">kuil09.github.io/lawmaker-monitor</text>
  <path d="M14 14h22M14 14v22M1186 14h-22M1186 14v22M14 616h22M14 616v-22M1186 616h-22M1186 616v-22" fill="none" stroke="${MEMBER_CARD_PALETTE.limeDark}" stroke-width="3" />
</svg>`;
}

export async function renderMemberCardPng({ svg, fetchImpl, timeoutMs }) {
  const renderer = new Resvg(svg, {
    fitTo: {
      mode: "width",
      value: 1200
    },
    font: {
      fontFiles: DEFAULT_CARD_FONT_FILES,
      loadSystemFonts: false,
      defaultFontFamily: "Noto Sans KR"
    }
  });

  await Promise.all(
    renderer.imagesToResolve().map(async (href) => {
      if (href.startsWith("data:")) {
        return;
      }

      try {
        const response = await fetchImpl(href, {
          headers: isAssemblyUrl(href) ? ASSEMBLY_REQUEST_HEADERS : undefined,
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok) {
          throw new Error(`returned ${response.status}`);
        }
        const image = Buffer.from(await response.arrayBuffer());
        if (image.length === 0) {
          throw new Error("returned an empty image");
        }
        renderer.resolveImage(href, image);
      } catch (error) {
        throw new Error(
          `[member-share] portrait image could not be loaded from ${href}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { cause: error }
        );
      }
    })
  );

  return renderer.render().asPng();
}

export function renderMemberShareHtml(model, googleAnalyticsMeasurementId) {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(model.title)} | 국회 출석부</title>
    <meta name="description" content="${escapeHtml(model.description)}" />
    <link rel="canonical" href="${escapeHtml(model.canonicalUrl)}" />
    <meta property="og:type" content="profile" />
    <meta property="og:locale" content="ko_KR" />
    <meta property="og:site_name" content="국회 출석부" />
    <meta property="og:title" content="${escapeHtml(model.title)}" />
    <meta property="og:description" content="${escapeHtml(
      model.description
    )}" />
    <meta property="og:url" content="${escapeHtml(model.canonicalUrl)}" />
    <meta property="og:image" content="${escapeHtml(model.imageUrl)}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeHtml(
      `${model.name} 의원의 국회 활동 기록 카드`
    )}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(model.title)}" />
    <meta name="twitter:description" content="${escapeHtml(
      model.description
    )}" />
    <meta name="twitter:image" content="${escapeHtml(model.imageUrl)}" />
${renderGoogleAnalyticsTag(googleAnalyticsMeasurementId, model.canonicalUrl)}
    <script>
      window.location.replace(${serializeScriptValue(model.activityUrl)});
    </script>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(model.title)}</h1>
      <p>${escapeHtml(model.description)}</p>
      <p><a href="${escapeHtml(model.activityUrl)}">의원 상세 기록 보기</a></p>
    </main>
  </body>
</html>`;
}

export async function generateMemberSharePages({
  distDir = DEFAULT_DIST_DIR,
  appBaseUrl = DEFAULT_APP_BASE_URL,
  dataRepoBaseUrl = DEFAULT_DATA_REPO_BASE_URL,
  googleAnalyticsMeasurementId = process.env.VITE_GA_MEASUREMENT_ID,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS
} = {}) {
  const normalizedAppBaseUrl = normalizeBaseUrl(appBaseUrl);
  const normalizedDataRepoBaseUrl = normalizeBaseUrl(dataRepoBaseUrl);
  const warnings = [];
  const manifestUrl = new URL(
    "manifests/latest.json",
    normalizedDataRepoBaseUrl
  ).toString();
  const manifest = await fetchOptionalJson(
    fetchImpl,
    manifestUrl,
    warnings,
    timeoutMs
  );
  const sourceRequests = [
    [
      "activityCalendar",
      getExportPath(
        manifest,
        "memberActivityCalendar",
        "exports/member_activity_calendar.json"
      )
    ],
    [
      "accountabilitySummary",
      getExportPath(
        manifest,
        "accountabilitySummary",
        "exports/accountability_summary.json"
      )
    ],
    [
      "memberAssetsIndex",
      getExportPath(
        manifest,
        "memberAssetsIndex",
        "exports/member_assets_index.json"
      )
    ],
    [
      "billProposalActivity",
      getExportPath(
        manifest,
        "billProposalActivity",
        "exports/bill_proposal_activity.json"
      )
    ]
  ];
  const sourceEntries = await Promise.all(
    sourceRequests.map(async ([key, path]) => [
      key,
      await fetchOptionalJson(
        fetchImpl,
        new URL(path, normalizedDataRepoBaseUrl).toString(),
        warnings,
        timeoutMs
      )
    ])
  );
  const sources = Object.fromEntries(sourceEntries);
  const statementsIndex = await fetchOptionalJson(
    fetchImpl,
    new URL(
      "exports/member_statement_summaries/index.json",
      normalizedDataRepoBaseUrl
    ).toString(),
    warnings,
    timeoutMs
  );
  const memberStatementSummaries = new Map();

  await runInBatches(
    statementsIndex?.members ?? [],
    STATEMENT_FETCH_CONCURRENCY,
    async (member) => {
      if (!member?.memberId || !member?.path) {
        return;
      }
      const statements = await fetchOptionalJson(
        fetchImpl,
        new URL(member.path, normalizedDataRepoBaseUrl).toString(),
        warnings,
        timeoutMs
      );
      if (statements) {
        memberStatementSummaries.set(member.memberId, statements);
      }
    }
  );

  const members = mergeMemberShareSources({
    ...sources,
    memberStatementSummaries
  });

  if (members.length === 0) {
    throw new Error(
      `[member-share] no valid member data was available: ${warnings.join("; ")}`
    );
  }

  const generatedAt =
    [
      manifest?.updatedAt,
      statementsIndex?.generatedAt,
      sources.activityCalendar?.generatedAt,
      sources.accountabilitySummary?.generatedAt
    ]
      .filter((value) => typeof value === "string" && value)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ??
    new Date().toISOString();
  const snapshotId =
    manifest?.snapshotId ??
    sources.activityCalendar?.snapshotId ??
    sources.accountabilitySummary?.snapshotId ??
    "unversioned";
  const cardVersion = createHash("sha256")
    .update(
      JSON.stringify({
        cardRendererVersion: CARD_RENDERER_VERSION,
        snapshotId,
        statementsGeneratedAt: statementsIndex?.generatedAt ?? null,
        statementsPromptVersion: statementsIndex?.promptVersion ?? null
      })
    )
    .digest("hex")
    .slice(0, 16);
  const assemblyLabel =
    manifest?.currentAssembly?.label ??
    sources.activityCalendar?.assemblyLabel ??
    sources.accountabilitySummary?.assemblyLabel ??
    "국회";
  const assemblyNo =
    manifest?.currentAssembly?.assemblyNo ??
    sources.activityCalendar?.assemblyNo ??
    sources.activityCalendar?.assembly?.assemblyNo;
  if (!Number.isInteger(assemblyNo) || assemblyNo <= 0) {
    throw new Error(
      "[member-share] a valid current assembly number is required"
    );
  }
  const context = {
    appBaseUrl: normalizedAppBaseUrl,
    generatedAt,
    snapshotId,
    cardVersion,
    assemblyLabel,
    assemblyNo
  };
  const manifestEntries = [];
  const assemblyPortraitCircuit = createAssemblyPortraitCircuit({
    onOpen: () => {
      warnings.push(
        `[member-share] Assembly portrait circuit opened after ${ASSEMBLY_PORTRAIT_CIRCUIT_FAILURE_THRESHOLD} consecutive unavailable resources; reusing published cards for remaining members`
      );
    }
  });

  await runInBatches(members, CARD_GENERATION_CONCURRENCY, async (member) => {
    let portraitDataUrl = null;
    let portraitError = null;
    try {
      portraitDataUrl = await resolveMemberPortraitDataUrl({
        member,
        assemblyNo: context.assemblyNo,
        fetchImpl,
        warnings,
        timeoutMs,
        assemblyPortraitCircuit
      });
    } catch (error) {
      portraitError = error;
      if (!(error instanceof AssemblyPortraitCircuitOpenError)) {
        warnings.push(error instanceof Error ? error.message : String(error));
      }
    }
    const model = buildMemberCardModel(
      {
        ...member,
        photoUrl: portraitDataUrl
      },
      context
    );
    const memberPagePath = resolve(
      distDir,
      "members",
      model.encodedMemberId,
      "index.html"
    );
    const cardPath = resolve(
      distDir,
      "member-cards",
      `${model.encodedMemberId}.png`
    );
    let cardPng = null;
    if (portraitDataUrl) {
      const cardSvg = renderMemberCardSvg(model);
      cardPng = await renderMemberCardPng({
        svg: cardSvg,
        fetchImpl,
        warnings,
        timeoutMs
      });
    } else {
      cardPng = await fetchPublishedMemberCardPng({
        fetchImpl,
        url: model.imageUrl,
        warnings,
        timeoutMs
      });
    }
    if (!cardPng) {
      throw (
        portraitError ??
        new Error(
          `[member-share] a verified portrait or published card is required for ${member.name} (${member.memberId})`
        )
      );
    }
    await Promise.all([
      mkdir(dirname(memberPagePath), { recursive: true }),
      mkdir(dirname(cardPath), { recursive: true })
    ]);
    await Promise.all([
      writeFile(
        memberPagePath,
        renderMemberShareHtml(model, googleAnalyticsMeasurementId),
        "utf8"
      ),
      writeFile(cardPath, cardPng)
    ]);
    manifestEntries.push({
      memberId: model.memberId,
      name: model.name,
      canonicalUrl: model.canonicalUrl,
      imageUrl: model.imageUrl
    });
  });

  manifestEntries.sort(
    (left, right) =>
      left.name.localeCompare(right.name, "ko-KR") ||
      left.memberId.localeCompare(right.memberId)
  );
  const cardsManifestPath = resolve(distDir, "member-cards", "index.json");
  await writeFile(
    cardsManifestPath,
    `${JSON.stringify(
      {
        generatedAt,
        snapshotId,
        cardVersion,
        cardRendererVersion: CARD_RENDERER_VERSION,
        count: manifestEntries.length,
        members: manifestEntries
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  return {
    status: "generated",
    count: manifestEntries.length,
    warnings
  };
}

const cliEntryUrl = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;

if (cliEntryUrl && import.meta.url === cliEntryUrl) {
  if (process.env.SKIP_MEMBER_SHARE_GENERATION === "1") {
    console.log("[member-share] skipped for the isolated UI test build");
  } else {
    const appBaseUrl = resolveAppBaseUrl(process.env);
    const dataRepoBaseUrl = normalizeOptionalBaseUrl(
      process.env.MEMBER_SHARE_DATA_REPO_BASE_URL ??
        process.env.VITE_DATA_REPO_BASE_URL ??
        process.env.DATA_REPO_BASE_URL,
      DEFAULT_DATA_REPO_BASE_URL
    );
    const result = await generateMemberSharePages({
      appBaseUrl,
      dataRepoBaseUrl
    });

    console.log(
      `[member-share] generated ${result.count} member pages at ${appBaseUrl}`
    );
    if (result.warnings.length > 0) {
      console.warn(`[member-share] ${result.warnings.join("; ")}`);
    }
  }
}
