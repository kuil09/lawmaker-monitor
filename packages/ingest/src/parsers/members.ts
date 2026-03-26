import type { MemberProfile, MemberRecord } from "@lawmaker-monitor/schemas";

import { parseXmlDocument, pickFirst } from "../utils.js";
import {
  buildOfficialProfileUrl,
  extractAssemblyNumbers,
  findItems,
  normalizeAssemblyLabel,
  normalizeAssemblyNo,
  normalizeCommitteeMemberships,
  normalizeCurrentSegment,
  normalizeDate,
  normalizeMultilineText,
  normalizeNameList,
  normalizeNullableText,
  normalizeOfficialExternalUrl,
  normalizeOptionalUrl,
  normalizeUrlAgainstAssemblyOrigin
} from "./helpers.js";
import type {
  MemberInfoParseResult,
  MemberProfileAllParseResult,
  MemberProfileAllRecord,
  MemberTenureRecord
} from "./types.js";

function buildMemberInfoProfile(values: {
  nameHanja?: string | null;
  nameEnglish?: string | null;
  birthType?: string | null;
  birthDate?: string | null;
  roleName?: string | null;
  reelectionLabel?: string | null;
  electedAssembliesLabel?: string | null;
  gender?: string | null;
  representativeCommitteeName?: string | null;
  affiliatedCommitteeName?: string | null;
  briefHistory?: string | null;
  officeRoom?: string | null;
  officePhone?: string | null;
  email?: string | null;
  aideNames?: string[];
  chiefSecretaryNames?: string[];
  secretaryNames?: string[];
}): MemberProfile | undefined {
  const profile: MemberProfile = {
    nameHanja: values.nameHanja ?? null,
    nameEnglish: values.nameEnglish ?? null,
    birthType: values.birthType ?? null,
    birthDate: values.birthDate ?? null,
    roleName: values.roleName ?? null,
    reelectionLabel: values.reelectionLabel ?? null,
    electedAssembliesLabel: values.electedAssembliesLabel ?? null,
    gender: values.gender ?? null,
    representativeCommitteeName: values.representativeCommitteeName ?? null,
    affiliatedCommitteeName: values.affiliatedCommitteeName ?? null,
    briefHistory: values.briefHistory ?? null,
    officeRoom: values.officeRoom ?? null,
    officePhone: values.officePhone ?? null,
    email: values.email ?? null,
    aideNames: values.aideNames ?? [],
    chiefSecretaryNames: values.chiefSecretaryNames ?? [],
    secretaryNames: values.secretaryNames ?? []
  };

  const hasScalarValue = Object.entries(profile).some(([key, item]) => {
    if (Array.isArray(item)) {
      return item.length > 0;
    }

    if (key === "briefHistory") {
      return Boolean(item);
    }

    return item !== null && item !== undefined;
  });

  return hasScalarValue ? profile : undefined;
}

function parseLegacyMemberInfoRow(row: Record<string, unknown>): MemberRecord | null {
  const memberId = pickFirst(row, ["MONA_CD", "monaCd"]);
  const name = pickFirst(row, ["HG_NM", "hgNm"]);
  const party = pickFirst(row, ["POLY_NM", "polyNm"]);
  const districts = pickFirst(row, ["ORIG_NM", "origNm"]);
  const units = pickFirst(row, ["UNITS", "units", "UNIT_NM", "unitNm"]);
  const assemblyNumbers = extractAssemblyNumbers(units);
  const assemblyNo = assemblyNumbers.at(-1) ?? 0;

  if (!memberId || !name || !party || assemblyNo <= 0) {
    return null;
  }

  const officialProfileUrl = buildOfficialProfileUrl(
    assemblyNo,
    pickFirst(row, ["ENG_NM", "engNm"])
  );

  return {
    memberId,
    name,
    party,
    district: districts ?? null,
    committeeMemberships: normalizeCommitteeMemberships(
      pickFirst(row, ["CMITS", "cmits", "CMIT_NM", "cmitNm"]) ?? ""
    ),
    photoUrl: normalizeOptionalUrl(pickFirst(row, ["DEPT_IMG_URL", "deptImgUrl"])),
    officialProfileUrl,
    officialExternalUrl: normalizeOfficialExternalUrl(
      pickFirst(row, ["HOMEPAGE", "homepage"]),
      officialProfileUrl
    ),
    isCurrentMember: true,
    proportionalFlag:
      pickFirst(row, ["ELECT_GBN_NM", "electGbnNm", "ORIG_NM", "origNm"]) === "비례대표",
    assemblyNo
  };
}

export function parseLegacyMemberInfoXml(xml: string): MemberInfoParseResult {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);
  const members: MemberRecord[] = [];
  let currentAssemblyNo = 0;

  for (const row of rows) {
    const member = parseLegacyMemberInfoRow(row);
    if (!member) {
      continue;
    }

    currentAssemblyNo = Math.max(currentAssemblyNo, member.assemblyNo);
    members.push(member);
  }

  return {
    members,
    currentAssembly:
      currentAssemblyNo > 0
        ? {
            assemblyNo: currentAssemblyNo,
            label: normalizeAssemblyLabel(`제${currentAssemblyNo}대`)
          }
        : null
  };
}

function extractDateTokens(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  const matches =
    value.match(/\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/g) ??
    value.match(/\d{1,2}-[A-Za-z]{3}-\d{2,4}/g) ??
    [];

  return matches
    .map((token) => normalizeDate(token))
    .filter((token): token is string => Boolean(token));
}

function normalizeTenurePeriod(record: Record<string, unknown>): {
  startDate: string;
  endDate: string | null;
} | null {
  const frtoDate = pickFirst(record, ["FRTO_DATE", "frtoDate", "PROFILE_DATE", "profileDate"]);
  const profile = pickFirst(record, ["PROFILE_SJ", "profileSj"]);
  const tokens = [...extractDateTokens(frtoDate), ...extractDateTokens(profile)];
  const uniqueTokens = [...new Set(tokens)].sort();
  const startDate = uniqueTokens[0];

  if (!startDate) {
    return null;
  }

  return {
    startDate,
    endDate: uniqueTokens[1] ?? null
  };
}

export function parseMemberProfileAllXml(xml: string): MemberProfileAllParseResult {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);
  const candidateProfiles: MemberProfileAllRecord[] = [];
  let currentAssemblyNo = 0;

  for (const row of rows) {
    const naasCd = pickFirst(row, ["NAAS_CD", "naasCd"]);
    const name = pickFirst(row, ["NAAS_NM", "naasNm"]);
    const party = normalizeCurrentSegment(pickFirst(row, ["PLPT_NM", "plptNm"]));
    const district = normalizeCurrentSegment(pickFirst(row, ["ELECD_NM", "elecdNm"]));
    const electionDivision = normalizeCurrentSegment(
      pickFirst(row, ["ELECD_DIV_NM", "elecdDivNm"])
    );
    const representativeCommitteeName = normalizeNullableText(
      pickFirst(row, ["CMIT_NM", "cmitNm"])
    );
    const affiliatedCommitteeName = normalizeNullableText(
      pickFirst(row, ["BLNG_CMIT_NM", "blngCmitNm"])
    );
    const electedAssembliesLabel = normalizeNullableText(
      pickFirst(row, ["GTELT_ERACO", "gteltEraco"])
    );
    const assemblyNumbers = extractAssemblyNumbers(electedAssembliesLabel);
    const assemblyNo = assemblyNumbers.at(-1) ?? 0;

    currentAssemblyNo = Math.max(currentAssemblyNo, assemblyNo);

    if (!naasCd || !name || !party || assemblyNo <= 0) {
      continue;
    }

    const nameEnglish = normalizeNullableText(pickFirst(row, ["NAAS_EN_NM", "naasEnNm"]));
    const officialProfileUrl = buildOfficialProfileUrl(
      assemblyNo,
      nameEnglish
    );
    const committeeMemberships = [
      ...normalizeCommitteeMemberships(affiliatedCommitteeName ?? ""),
      ...normalizeCommitteeMemberships(representativeCommitteeName ?? "")
    ];

    candidateProfiles.push({
      naasCd,
      name,
      party,
      district: district ?? null,
      committeeMemberships: [...new Set(committeeMemberships)],
      photoUrl: normalizeUrlAgainstAssemblyOrigin(pickFirst(row, ["NAAS_PIC", "naasPic"])),
      officialProfileUrl,
      officialExternalUrl: normalizeOfficialExternalUrl(
        pickFirst(row, ["NAAS_HP_URL", "naasHpUrl"]),
        officialProfileUrl
      ),
      profile: buildMemberInfoProfile({
        nameHanja: normalizeNullableText(pickFirst(row, ["NAAS_CH_NM", "naasChNm"])),
        nameEnglish,
        birthType: normalizeNullableText(pickFirst(row, ["BIRDY_DIV_CD", "birdyDivCd"])),
        birthDate: normalizeDate(pickFirst(row, ["BIRDY_DT", "birdyDt"])) ?? null,
        roleName: normalizeNullableText(pickFirst(row, ["DTY_NM", "dtyNm"])),
        reelectionLabel: normalizeNullableText(pickFirst(row, ["RLCT_DIV_NM", "rlctDivNm"])),
        electedAssembliesLabel,
        gender: normalizeNullableText(pickFirst(row, ["NTR_DIV", "ntrDiv"])),
        representativeCommitteeName,
        affiliatedCommitteeName,
        briefHistory: normalizeMultilineText(pickFirst(row, ["BRF_HST", "brfHst"])),
        officeRoom: normalizeNullableText(pickFirst(row, ["OFFM_RNUM_NO", "offmRnumNo"])),
        officePhone: normalizeNullableText(pickFirst(row, ["NAAS_TEL_NO", "naasTelNo"])),
        email: normalizeNullableText(
          pickFirst(row, ["NAAS_EMAIL_ADDR", "naasEmailAddr"])
        ),
        aideNames: normalizeNameList(pickFirst(row, ["AIDE_NM", "aideNm"])),
        chiefSecretaryNames: normalizeNameList(
          pickFirst(row, ["CHF_SCRT_NM", "chfScrtNm"])
        ),
        secretaryNames: normalizeNameList(pickFirst(row, ["SCRT_NM", "scrtNm"]))
      }),
      proportionalFlag:
        electionDivision === "비례대표" ||
        electionDivision === "전국구" ||
        district === "비례대표",
      assemblyNo
    });
  }

  const profiles =
    currentAssemblyNo > 0
      ? candidateProfiles.filter((member) => member.assemblyNo === currentAssemblyNo)
      : candidateProfiles;

  return {
    profiles,
    currentAssembly:
      currentAssemblyNo > 0
        ? {
            assemblyNo: currentAssemblyNo,
            label: normalizeAssemblyLabel(`제${currentAssemblyNo}대`)
          }
        : null
  };
}

export function parseMemberInfoXml(xml: string): MemberInfoParseResult {
  return parseLegacyMemberInfoXml(xml);
}

export function parseMemberHistoryXml(xml: string): MemberTenureRecord[] {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);

  const records: MemberTenureRecord[] = [];

  for (const row of rows) {
    const memberId = pickFirst(row, ["MONA_CD", "monaCd", "memberId", "MEMBER_ID"]);
    const name = pickFirst(row, ["HG_NM", "hgNm", "name", "NAME"]);
    const unitCd = pickFirst(row, ["UNIT_CD", "unitCd"]);
    const assemblyNo = normalizeAssemblyNo(row);
    const period = normalizeTenurePeriod(row);

    if (!memberId || !name || assemblyNo <= 0 || !period) {
      continue;
    }

    records.push({
      memberId,
      name,
      assemblyNo,
      ...(unitCd ? { unitCd } : {}),
      startDate: period.startDate,
      endDate: period.endDate
    });
  }

  return records;
}
