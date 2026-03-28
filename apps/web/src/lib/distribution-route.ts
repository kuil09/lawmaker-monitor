import type { DistributionBehaviorFilter } from "./distribution.js";

export function buildDistributionHash({
  memberId,
  behaviorFilter
}: {
  memberId?: string | null;
  behaviorFilter?: DistributionBehaviorFilter | null;
} = {}): string {
  const params = new URLSearchParams();

  if (behaviorFilter) {
    params.set("behavior", behaviorFilter);
  }

  if (memberId) {
    params.set("member", memberId);
  }

  const query = params.toString();
  return query ? `distribution?${query}` : "distribution";
}

export function buildDistributionHref({
  memberId,
  behaviorFilter
}: {
  memberId?: string | null;
  behaviorFilter?: DistributionBehaviorFilter | null;
} = {}): string {
  return `#${buildDistributionHash({ memberId, behaviorFilter })}`;
}
