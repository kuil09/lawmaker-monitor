const productionOrigin = "https://kuil09.github.io";

function requireMemberId(memberId: string): string {
  const normalizedMemberId = memberId.trim();

  if (!normalizedMemberId) {
    throw new Error("memberId is required.");
  }

  return normalizedMemberId;
}

export function normalizeAppBasePath(basePath: string): string {
  const trimmedBasePath = basePath.trim();
  const withLeadingSlash = trimmedBasePath.startsWith("/")
    ? trimmedBasePath
    : `/${trimmedBasePath}`;

  return `${withLeadingSlash.replace(/\/+$/, "")}/`;
}

export function buildMemberCanonicalPath(
  memberId: string,
  basePath = import.meta.env.BASE_URL
): string {
  const normalizedMemberId = requireMemberId(memberId);
  const normalizedBasePath = normalizeAppBasePath(basePath || "/");

  return `${normalizedBasePath}members/${encodeURIComponent(normalizedMemberId)}/`;
}

export function buildMemberCanonicalUrl(
  memberId: string,
  options: {
    origin?: string;
    basePath?: string;
  } = {}
): string {
  const origin =
    options.origin ??
    (typeof window === "undefined" ? productionOrigin : window.location.origin);
  const basePath = options.basePath ?? import.meta.env.BASE_URL;

  return new URL(
    buildMemberCanonicalPath(memberId, basePath),
    origin
  ).toString();
}

export function buildMemberCardImageUrl(
  memberId: string,
  options: {
    origin?: string;
    basePath?: string;
  } = {}
): string {
  const origin =
    options.origin ??
    (typeof window === "undefined" ? productionOrigin : window.location.origin);
  const normalizedBasePath = normalizeAppBasePath(
    options.basePath ?? import.meta.env.BASE_URL
  );

  return new URL(
    `${normalizedBasePath}member-cards/${encodeURIComponent(
      requireMemberId(memberId)
    )}.png`,
    origin
  ).toString();
}

export function buildMemberActivityHash(memberId: string): string {
  return `#calendar?member=${encodeURIComponent(requireMemberId(memberId))}`;
}

export function buildMemberActivityUrl(
  memberId: string,
  options: {
    origin?: string;
    basePath?: string;
  } = {}
): string {
  const origin =
    options.origin ??
    (typeof window === "undefined" ? productionOrigin : window.location.origin);
  const basePath = normalizeAppBasePath(
    options.basePath ?? import.meta.env.BASE_URL
  );
  const appUrl = new URL(basePath, origin);

  appUrl.hash = buildMemberActivityHash(memberId).slice(1);
  return appUrl.toString();
}

export function buildMemberShareData(
  member: {
    memberId: string;
    name: string;
    party?: string | null;
    district?: string | null;
  },
  options: {
    origin?: string;
    basePath?: string;
  } = {}
): ShareData {
  const affiliation = [member.party, member.district]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" · ");

  return {
    title: `${member.name} 의원 기록 카드`,
    text: affiliation
      ? `${member.name} 의원의 국회 활동 기록 (${affiliation})`
      : `${member.name} 의원의 국회 활동 기록`,
    url: buildMemberCanonicalUrl(member.memberId, options)
  };
}
