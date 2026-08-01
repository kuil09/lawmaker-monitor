export function formatRepresentation(district?: string | null): string {
  const normalizedDistrict = district?.trim();
  return normalizedDistrict || "지역 정보 미확인";
}

export function formatMemberAffiliation(
  party?: string | null,
  district?: string | null
): string {
  const normalizedParty = party?.trim();
  const representation = formatRepresentation(district);
  return normalizedParty
    ? `${normalizedParty} · ${representation}`
    : representation;
}
