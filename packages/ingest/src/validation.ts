import {
  accountabilitySummaryExportSchema,
  accountabilityTrendsExportSchema,
  constituencyBoundaryExportSchema,
  constituencyBoundariesIndexExportSchema,
  hexmapStaticIndexExportSchema,
  hexmapStaticProvinceArtifactSchema,
  latestVotesExportSchema,
  manifestSchema,
  memberAssetsHistoryExportSchema,
  memberAssetsIndexExportSchema,
  memberActivityCalendarExportSchema,
  memberActivityCalendarMemberDetailExportSchema,
  normalizedBundleSchema
} from "@lawmaker-monitor/schemas";

import type {
  AccountabilitySummaryExport,
  AccountabilityTrendsExport,
  ConstituencyBoundaryExport,
  ConstituencyBoundariesIndexExport,
  HexmapStaticIndexExport,
  HexmapStaticProvinceArtifact,
  LatestVotesExport,
  Manifest,
  MemberAssetsHistoryExport,
  MemberAssetsIndexExport,
  MemberActivityCalendarExport,
  MemberActivityCalendarMemberDetailExport,
  NormalizedBundle
} from "@lawmaker-monitor/schemas";

export function validateNormalizedBundle(bundle: NormalizedBundle): NormalizedBundle {
  const parsed = normalizedBundleSchema.parse(bundle);
  assertCriticalFields(parsed);
  return parsed;
}

export function validateLatestVotesExport(payload: LatestVotesExport): LatestVotesExport {
  return latestVotesExportSchema.parse(payload);
}

export function validateAccountabilitySummaryExport(
  payload: AccountabilitySummaryExport
): AccountabilitySummaryExport {
  return accountabilitySummaryExportSchema.parse(payload);
}

export function validateAccountabilityTrendsExport(
  payload: AccountabilityTrendsExport
): AccountabilityTrendsExport {
  return accountabilityTrendsExportSchema.parse(payload);
}

export function validateMemberActivityCalendarExport(
  payload: MemberActivityCalendarExport
): MemberActivityCalendarExport {
  return memberActivityCalendarExportSchema.parse(payload);
}

export function validateMemberActivityCalendarMemberDetailExport(
  payload: MemberActivityCalendarMemberDetailExport
): MemberActivityCalendarMemberDetailExport {
  return memberActivityCalendarMemberDetailExportSchema.parse(payload);
}

export function validateMemberAssetsIndexExport(
  payload: MemberAssetsIndexExport
): MemberAssetsIndexExport {
  return memberAssetsIndexExportSchema.parse(payload);
}

export function validateMemberAssetsHistoryExport(
  payload: MemberAssetsHistoryExport
): MemberAssetsHistoryExport {
  return memberAssetsHistoryExportSchema.parse(payload);
}

export function validateConstituencyBoundaryExport(
  payload: ConstituencyBoundaryExport
): ConstituencyBoundaryExport {
  return constituencyBoundaryExportSchema.parse(payload);
}

export function validateConstituencyBoundariesIndexExport(
  payload: ConstituencyBoundariesIndexExport
): ConstituencyBoundariesIndexExport {
  return constituencyBoundariesIndexExportSchema.parse(payload);
}

export function validateHexmapStaticIndexExport(
  payload: HexmapStaticIndexExport
): HexmapStaticIndexExport {
  return hexmapStaticIndexExportSchema.parse(payload);
}

export function validateHexmapStaticProvinceArtifact(
  payload: HexmapStaticProvinceArtifact
): HexmapStaticProvinceArtifact {
  return hexmapStaticProvinceArtifactSchema.parse(payload);
}

export function validateManifest(payload: Manifest): Manifest {
  return manifestSchema.parse(payload);
}

function assertCriticalFields(bundle: NormalizedBundle): void {
  if (bundle.rollCalls.length === 0) {
    throw new Error("At least one roll call must be present.");
  }

  for (const rollCall of bundle.rollCalls) {
    if (!rollCall.officialSourceUrl || !rollCall.snapshotId || !rollCall.sourceHash) {
      throw new Error(`Roll call ${rollCall.rollCallId} is missing traceability metadata.`);
    }
  }
}

export function assertSinglePublicAssembly(bundle: NormalizedBundle): void {
  const assemblyNumbers = new Set<number>();

  for (const member of bundle.members) {
    assemblyNumbers.add(member.assemblyNo);
  }

  for (const rollCall of bundle.rollCalls) {
    assemblyNumbers.add(rollCall.assemblyNo);
  }

  if (assemblyNumbers.size !== 1) {
    throw new Error("Public exports must contain exactly one Assembly.");
  }
}
