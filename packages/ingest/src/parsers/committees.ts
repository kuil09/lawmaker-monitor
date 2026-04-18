import { parseXmlDocument, pickFirst, toNumber } from "../utils.js";
import {
  buildAgendaSummary,
  findItems,
  normalizeOptionalUrl
} from "./helpers.js";

import type {
  BillVoteSummaryRecord,
  CommitteeOverviewRecord,
  CommitteeRosterRecord
} from "./types.js";

export function parseCommitteeRosterXml(xml: string): CommitteeRosterRecord[] {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);

  return rows
    .map((row) => {
      const memberId = pickFirst(row, ["MONA_CD", "monaCd"]);
      const memberName = pickFirst(row, ["HG_NM", "hgNm"]);
      const committeeName = pickFirst(row, ["DEPT_NM", "deptNm"]);

      if (!memberId || !memberName || !committeeName) {
        return undefined;
      }

      return {
        memberId,
        memberName,
        party: pickFirst(row, ["POLY_NM", "polyNm"]) ?? null,
        district: pickFirst(row, ["ORIG_NM", "origNm"]) ?? null,
        committeeName
      };
    })
    .filter((row): row is CommitteeRosterRecord => Boolean(row));
}

export function parseCommitteeOverviewXml(
  xml: string
): CommitteeOverviewRecord[] {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);

  const records: CommitteeOverviewRecord[] = [];

  for (const row of rows) {
    const committeeName = pickFirst(row, ["COMMITTEE_NAME", "committeeName"]);
    if (!committeeName) {
      continue;
    }

    const memberLimitRaw = pickFirst(row, ["LIMIT_CNT", "limitCnt"]);
    const currentMemberCountRaw = pickFirst(row, ["CURR_CNT", "currCnt"]);

    records.push({
      committeeName,
      committeeType: pickFirst(row, ["CMT_DIV_NM", "cmtDivNm"]) ?? null,
      memberLimit:
        memberLimitRaw === undefined ? null : toNumber(memberLimitRaw),
      currentMemberCount:
        currentMemberCountRaw === undefined
          ? null
          : toNumber(currentMemberCountRaw)
    });
  }

  return records;
}

export function parseBillVoteSummaryXml(xml: string): BillVoteSummaryRecord[] {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);

  return rows
    .map((row) => {
      const billId = pickFirst(row, ["BILL_ID", "billId"]);
      const billNo = pickFirst(row, ["BILL_NO", "billNo"]);
      const billName = pickFirst(row, ["BILL_NAME", "billName"]);
      const registeredCountRaw = pickFirst(row, ["MEMBER_TCNT", "memberTcnt"]);
      const presentCountRaw = pickFirst(row, ["VOTE_TCNT", "voteTcnt"]);
      const yesCountRaw = pickFirst(row, ["YES_TCNT", "yesTcnt"]);
      const noCountRaw = pickFirst(row, ["NO_TCNT", "noTcnt"]);
      const abstainCountRaw = pickFirst(row, ["BLANK_TCNT", "blankTcnt"]);
      const officialSourceUrl = normalizeOptionalUrl(
        pickFirst(row, ["LINK_URL", "linkUrl"])
      );

      if (
        !billId ||
        !billNo ||
        !billName ||
        registeredCountRaw === undefined ||
        presentCountRaw === undefined ||
        yesCountRaw === undefined ||
        noCountRaw === undefined ||
        abstainCountRaw === undefined ||
        !officialSourceUrl
      ) {
        return undefined;
      }

      const registeredCount = toNumber(registeredCountRaw);
      const presentCount = toNumber(presentCountRaw);
      const yesCount = toNumber(yesCountRaw);
      const noCount = toNumber(noCountRaw);
      const abstainCount = toNumber(abstainCountRaw);

      return {
        billId,
        billNo,
        billName,
        committeeName:
          pickFirst(row, ["CURR_COMMITTEE", "currCommittee"]) ?? null,
        officialSourceUrl,
        officialTally: {
          registeredCount,
          presentCount,
          yesCount,
          noCount,
          abstainCount,
          invalidCount: 0
        },
        summary: buildAgendaSummary(row) ?? null
      };
    })
    .filter((row): row is BillVoteSummaryRecord => Boolean(row));
}
