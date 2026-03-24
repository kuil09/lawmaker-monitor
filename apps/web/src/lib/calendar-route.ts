export type ActivityViewMode = "single" | "compare";

export function buildCalendarHash({
  memberId,
  compareMemberId,
  view
}: {
  memberId?: string | null;
  compareMemberId?: string | null;
  view?: ActivityViewMode;
} = {}): string {
  const params = new URLSearchParams();

  if (memberId) {
    params.set("member", memberId);
  }

  if (compareMemberId) {
    params.set("compare", compareMemberId);
  }

  if (view && view !== "single") {
    params.set("view", view);
  }

  const query = params.toString();
  return query ? `calendar?${query}` : "calendar";
}

export function buildCalendarHref({
  memberId,
  compareMemberId,
  view
}: {
  memberId?: string | null;
  compareMemberId?: string | null;
  view?: ActivityViewMode;
} = {}): string {
  return `#${buildCalendarHash({ memberId, compareMemberId, view })}`;
}
