export function buildDistributionHash({
  memberId
}: {
  memberId?: string | null;
} = {}): string {
  const params = new URLSearchParams();

  if (memberId) {
    params.set("member", memberId);
  }

  const query = params.toString();
  return query ? `distribution?${query}` : "distribution";
}

export function buildDistributionHref({
  memberId
}: {
  memberId?: string | null;
} = {}): string {
  return `#${buildDistributionHash({ memberId })}`;
}
