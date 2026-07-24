import { parseXmlDocument, pickFirst } from "../utils.js";
import { findItems, normalizeAssemblyNo, normalizeDate } from "./helpers.js";

import type { BillProposalRecord } from "./types.js";

function splitMemberIds(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return [
    ...new Set(
      value
        .replace(/<br\s*\/?>/gi, ",")
        .split(/[,;|\s]+/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  ];
}

export function parseBillProposalXml(xml: string): BillProposalRecord[] {
  const parsed = parseXmlDocument(xml);
  const rows = findItems(parsed);

  return rows.flatMap((row): BillProposalRecord[] => {
    const billId = pickFirst(row, ["BILL_ID", "billId"]);
    const billName = pickFirst(row, ["BILL_NAME", "BILL_NM", "billName"]);
    const assemblyNo = normalizeAssemblyNo(row);

    if (!billId || !billName || assemblyNo <= 0) {
      return [];
    }

    const leadMemberIds = splitMemberIds(
      pickFirst(row, ["RST_MONA_CD", "REP_MONA_CD", "rstMonaCd", "repMonaCd"])
    );
    const leadMemberIdSet = new Set(leadMemberIds);
    const coSponsorMemberIds = splitMemberIds(
      pickFirst(row, [
        "PUBL_MONA_CD",
        "PUBLIC_MONA_CD",
        "publMonaCd",
        "publicMonaCd"
      ])
    ).filter((memberId) => !leadMemberIdSet.has(memberId));

    return [
      {
        billId,
        billNo: pickFirst(row, ["BILL_NO", "billNo"]) ?? null,
        billName,
        assemblyNo,
        proposedAt:
          normalizeDate(
            pickFirst(row, [
              "PROPOSE_DT",
              "PPSL_DT",
              "PROPOSE_DATE",
              "proposeDt",
              "ppslDt"
            ])
          ) ?? null,
        leadMemberIds,
        coSponsorMemberIds
      }
    ];
  });
}
