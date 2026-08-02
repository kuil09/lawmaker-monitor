import { load } from "cheerio";

import { normalizeComparableText } from "./parsers/helpers.js";

export type LikmsNamedVoteRecord = {
  memberName: string;
  officialProfileUrl: string | null;
  voteCode: "yes" | "no" | "abstain";
};

export type LikmsVoteInfo = {
  billId: string;
  billNo: string;
  billName: string;
  voteDate: string;
  registeredCount: number;
  presentCount: number;
  yesCount: number;
  noCount: number;
  abstainCount: number;
  records: LikmsNamedVoteRecord[];
};

const voteSectionSelectors = [
  ["#voteAgreeList", "yes"],
  ["#voteDisAgreeList", "no"],
  ["#voteAbsList", "abstain"]
] as const;

export function parseLikmsVoteMemberListHtml(
  html: string
): LikmsNamedVoteRecord[] {
  const $ = load(html);
  const records: LikmsNamedVoteRecord[] = [];

  for (const [selector, voteCode] of voteSectionSelectors) {
    $(selector)
      .find("li a")
      .each((_, element) => {
        const anchor = $(element);
        const memberName = normalizeComparableText(
          anchor.find("p").first().text() ||
            anchor
              .find("img")
              .first()
              .attr("alt")
              ?.replace(/^국회의원:/, "")
        );
        const officialProfileUrl = anchor.attr("href")?.trim() ?? null;
        if (!memberName) {
          return;
        }

        records.push({
          memberName,
          officialProfileUrl,
          voteCode
        });
      });
  }

  const seenProfileVotes = new Set<string>();
  return records.filter((record) => {
    const profileUrl = record.officialProfileUrl?.trim();
    if (!profileUrl || profileUrl.startsWith("javascript:")) {
      return true;
    }
    const key = `${profileUrl}:${record.voteCode}`;
    if (seenProfileVotes.has(key)) {
      return false;
    }
    seenProfileVotes.add(key);
    return true;
  });
}

export function countLikmsNamedVotes(records: LikmsNamedVoteRecord[]): {
  yes: number;
  no: number;
  abstain: number;
  present: number;
} {
  const counts = { yes: 0, no: 0, abstain: 0, present: 0 };
  for (const record of records) {
    counts[record.voteCode] += 1;
    counts.present += 1;
  }
  return counts;
}

function readRequiredCount(
  value: string,
  pattern: RegExp,
  label: string
): number {
  const parsed = Number.parseInt(value.match(pattern)?.[1] ?? "", 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Official LIKMS vote response is missing ${label}.`);
  }
  return parsed;
}

export function parseLikmsVoteInfoHtml(html: string): LikmsVoteInfo {
  const $ = load(html);
  const billId = $("input[name='billId']").attr("value")?.trim() ?? "";
  const billNo = $("#voteBillNo").attr("value")?.trim() ?? "";
  const billName = $("#voteBillName").attr("value")?.trim() ?? "";
  const procDateText = normalizeComparableText($("#procDt").text());
  const voteDate = procDateText.match(/(\d{4}-\d{2}-\d{2})\s*$/)?.[1] ?? "";
  const memberCountText = normalizeComparableText($("#memberTcnt").text());
  const voteCountText = normalizeComparableText($("#voteTcnt").text());
  const records = parseLikmsVoteMemberListHtml(html);

  if (!billId || !billNo || !billName || !voteDate) {
    throw new Error("Official LIKMS vote response is missing bill metadata.");
  }

  const info: LikmsVoteInfo = {
    billId,
    billNo,
    billName,
    voteDate,
    registeredCount: readRequiredCount(
      memberCountText,
      /재적\s*(\d+)인/,
      "registered member count"
    ),
    presentCount: readRequiredCount(
      memberCountText,
      /재석\s*(\d+)인/,
      "present voter count"
    ),
    yesCount: readRequiredCount(voteCountText, /찬성\s*(\d+)인/, "yes count"),
    noCount: readRequiredCount(voteCountText, /반대\s*(\d+)인/, "no count"),
    abstainCount: readRequiredCount(
      voteCountText,
      /기권\s*(\d+)인/,
      "abstain count"
    ),
    records
  };
  const counts = countLikmsNamedVotes(records);
  if (
    counts.present !== info.presentCount ||
    counts.yes !== info.yesCount ||
    counts.no !== info.noCount ||
    counts.abstain !== info.abstainCount
  ) {
    throw new Error(
      `Official LIKMS named vote list does not match its embedded tally for ${billId}.`
    );
  }

  return info;
}
