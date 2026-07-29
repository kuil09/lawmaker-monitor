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
const CARD_GENERATION_CONCURRENCY = 8;
const STATEMENT_FETCH_CONCURRENCY = 16;
const SAFE_MEMBER_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

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

function formatInteger(value) {
  return new Intl.NumberFormat("ko-KR").format(value);
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
    facts.push(
      `기록표결 ${formatInteger(
        member.accountability.totalRecordedVotes
      )}건 중 불참 ${formatInteger(member.accountability.absentCount)}건`
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
    latestEvidenceHeadline
  };
}

export function renderMemberCardSvg(model) {
  const facts = [...model.facts, "공식 공개자료 기준"].slice(0, 3);
  const initials = [...model.name].slice(0, 2).join("");
  const photo = model.photoUrl
    ? `<image href="${escapeXml(
        model.photoUrl
      )}" x="74" y="118" width="302" height="372" preserveAspectRatio="xMidYMid slice" clip-path="url(#portraitClip)" filter="url(#newsprint)" />`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(model.title)}</title>
  <desc id="description">${escapeXml(model.description)}</desc>
  <defs>
    <pattern id="paper" width="8" height="8" patternUnits="userSpaceOnUse">
      <circle cx="1" cy="1" r="0.7" fill="#233330" opacity="0.14" />
    </pattern>
    <pattern id="halftone" width="7" height="7" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.2" fill="#132c2b" opacity="0.32" />
    </pattern>
    <clipPath id="portraitClip"><rect x="74" y="118" width="302" height="372" rx="8" /></clipPath>
    <filter id="newsprint">
      <feColorMatrix type="saturate" values="0" />
      <feComponentTransfer>
        <feFuncR type="linear" slope="1.25" intercept="-0.08" />
        <feFuncG type="linear" slope="1.25" intercept="-0.08" />
        <feFuncB type="linear" slope="1.25" intercept="-0.08" />
      </feComponentTransfer>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="#f2efe6" />
  <rect width="1200" height="630" fill="url(#paper)" />
  <rect x="0" y="0" width="24" height="630" fill="#b9342c" />
  <path d="M438 0H1200V630H416L454 510L420 392L458 280L424 158Z" fill="#173c3a" />
  <rect x="74" y="118" width="302" height="372" rx="8" fill="#d7d4ca" />
  <text x="225" y="330" text-anchor="middle" fill="#173c3a" font-size="92" font-weight="800" font-family="Noto Sans KR">${escapeXml(
    initials
  )}</text>
  ${photo}
  <rect x="74" y="118" width="302" height="372" rx="8" fill="url(#halftone)" opacity="0.32" />
  <text x="74" y="72" fill="#173c3a" font-size="25" font-weight="800" font-family="Noto Sans KR">감시 큐 · 의원 실적 카드</text>
  <text x="470" y="112" fill="#d8c9a3" font-size="23" font-weight="700" font-family="Noto Sans KR">${escapeXml(
    model.assemblyLabel
  )}</text>
  <text x="470" y="192" fill="#fffdf6" font-size="66" font-weight="900" font-family="Noto Sans KR">${escapeXml(
    model.name
  )}</text>
  <text x="470" y="238" fill="#d8c9a3" font-size="25" font-weight="700" font-family="Noto Sans KR">${escapeXml(
    truncate(`${model.party} · ${model.district}`, 42)
  )}</text>
  <line x1="470" y1="278" x2="1114" y2="278" stroke="#d8c9a3" stroke-width="2" opacity="0.6" />
  ${facts
    .map(
      (fact, index) => `<g transform="translate(470 ${334 + index * 66})">
    <rect x="0" y="-24" width="12" height="12" fill="${index === 0 ? "#d8c9a3" : "#b9342c"}" transform="rotate(45 6 -18)" />
    <text x="34" y="-8" fill="#fffdf6" font-size="27" font-weight="650" font-family="Noto Sans KR">${escapeXml(
      truncate(fact, 46)
    )}</text>
  </g>`
    )
    .join("\n  ")}
  ${
    model.latestEvidenceHeadline
      ? `<text x="470" y="510" fill="#d8c9a3" font-size="17" font-weight="700" font-family="Noto Sans KR">최근 회의록 안건</text>
  <text x="470" y="540" fill="#fffdf6" font-size="19" font-weight="650" font-family="Noto Sans KR">${escapeXml(
    model.latestEvidenceHeadline
  )}</text>`
      : ""
  }
  <text x="74" y="548" fill="#173c3a" font-size="20" font-weight="700" font-family="Noto Sans KR">수집 기준 ${escapeXml(
    formatDate(model.generatedAt)
  )}</text>
  <text x="74" y="580" fill="#5b6662" font-size="15" font-family="Noto Sans KR">분모·기간·공식 근거는 상세 화면에서 확인하세요.</text>
  <text x="1114" y="590" text-anchor="end" fill="#d8c9a3" font-size="19" font-weight="700" font-family="Noto Sans KR">kuil09.github.io/lawmaker-monitor</text>
</svg>`;
}

export async function renderMemberCardPng({
  svg,
  fetchImpl,
  warnings,
  timeoutMs
}) {
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
      try {
        const response = await fetchImpl(href, {
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!response.ok) {
          warnings.push(`${href} image returned ${response.status}`);
          return;
        }
        renderer.resolveImage(href, Buffer.from(await response.arrayBuffer()));
      } catch (error) {
        warnings.push(
          `${href} image could not be loaded: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    })
  );

  return renderer.render().asPng();
}

export function renderMemberShareHtml(model) {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(model.title)} | 국회 책임성 모니터</title>
    <meta name="description" content="${escapeHtml(model.description)}" />
    <link rel="canonical" href="${escapeHtml(model.canonicalUrl)}" />
    <meta property="og:type" content="profile" />
    <meta property="og:locale" content="ko_KR" />
    <meta property="og:site_name" content="국회 책임성 모니터" />
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
  const context = {
    appBaseUrl: normalizedAppBaseUrl,
    generatedAt,
    snapshotId,
    cardVersion,
    assemblyLabel
  };
  const manifestEntries = [];

  await runInBatches(members, CARD_GENERATION_CONCURRENCY, async (member) => {
    const model = buildMemberCardModel(member, context);
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
    const cardSvg = renderMemberCardSvg(model);
    const cardPng = await renderMemberCardPng({
      svg: cardSvg,
      fetchImpl,
      warnings,
      timeoutMs
    });
    await Promise.all([
      mkdir(dirname(memberPagePath), { recursive: true }),
      mkdir(dirname(cardPath), { recursive: true })
    ]);
    await Promise.all([
      writeFile(memberPagePath, renderMemberShareHtml(model), "utf8"),
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
