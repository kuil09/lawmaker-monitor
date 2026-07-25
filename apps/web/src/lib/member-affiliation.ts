export function formatRepresentation(district?: string | null): string {
  const normalizedDistrict = district?.trim();
  return normalizedDistrict || "비례대표";
}

export function formatMemberAffiliation(
  party?: string | null,
  district?: string | null
): string {
  const normalizedParty = party?.trim();
  if (district === undefined) {
    return normalizedParty || "소속 정보 없음";
  }

  const representation = formatRepresentation(district);
  return normalizedParty
    ? `${normalizedParty} · ${representation}`
    : representation;
}
