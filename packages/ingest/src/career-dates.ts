import type { CareerClaim } from "@lawmaker-monitor/schemas";

type CareerDates = Pick<
  CareerClaim,
  "startDate" | "endDate" | "precision" | "dateBasis" | "dateText"
>;
const unknown: CareerDates = {
  startDate: null,
  endDate: null,
  precision: "unknown",
  dateBasis: "undated",
  dateText: null
};
const datePart = String.raw`((?:19|20)\d{2})(?:[./년-]\s*(\d{1,2}))?(?:[./월-]\s*(\d{1,2}))?(?:일)?\.?`;

function boundary(
  year: string,
  month: string | undefined,
  day: string | undefined,
  end: boolean
): string | null {
  const y = Number(year);
  const m = month ? Number(month) : end ? 12 : 1;
  if (m < 1 || m > 12) return null;
  const maxDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const d = day ? Number(day) : end ? maxDay : 1;
  if (d < 1 || d > maxDay) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** A date annotates only the following biography clause; degrees are never job evidence. */
export function splitCareerClauses(
  line: string
): Array<{ evidence: string; dates: CareerDates }> {
  const matches = [
    ...line.matchAll(
      new RegExp(
        String.raw`${datePart}\s*(?:([~〜～–])\s*(?:${datePart})?)?`,
        "g"
      )
    )
  ];
  if (!matches.length) return [{ evidence: line, dates: unknown }];
  const starts = matches.map(
    (match) =>
      match.index -
      (line.slice(0, match.index).match(/[~〜～–]\s*$/)?.[0].length ?? 0)
  );
  const clauses: Array<{ evidence: string; dates: CareerDates }> = [];
  const prefix = line.slice(0, starts[0]).trim();
  if (prefix) clauses.push({ evidence: prefix, dates: unknown });
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i]!;
    const evidence = line.slice(starts[i], starts[i + 1]).trim();
    const precision = match[3] ? "day" : match[2] ? "month" : "year";
    const endOnly = /[~〜～–]\s*$/.test(line.slice(0, match.index));
    const startDate = endOnly
      ? null
      : boundary(match[1]!, match[2], match[3], false);
    const endDate = endOnly
      ? boundary(match[1]!, match[2], match[3], true)
      : match[5]
        ? boundary(match[5], match[6], match[7], true)
        : match[4]
          ? null
          : boundary(match[1]!, match[2], match[3], true);
    const valid =
      (startDate || endOnly) &&
      (!match[5] || endDate) &&
      (!startDate || !endDate || startDate <= endDate);
    clauses.push({
      evidence,
      dates: valid
        ? {
            startDate,
            endDate,
            precision,
            dateBasis: match[4] || endOnly ? "stated_period" : "dated_mention",
            dateText: `${endOnly ? "~" : ""}${match[0].trim()}`
          }
        : unknown
    });
  }
  return clauses;
}
