import type {
  AccountabilitySummaryExport,
  LatestVoteItem
} from "@lawmaker-monitor/schemas";

export const PLENARY_SEAT_COUNT = 300;

export const PLENARY_ROW_COUNTS = [16, 20, 22, 24, 26, 28, 30, 31, 32, 34, 37];

export type PlenarySeatOutcome =
  | "yes"
  | "no"
  | "abstain"
  | "absent"
  | "unlinked"
  | "vacant";

export type PlenarySeatPosition = {
  seatNumber: number;
  rowIndex: number;
  rowSeatIndex: number;
  xPercent: number;
  yPercent: number;
};

export type PlenarySeatAssignment = PlenarySeatPosition & {
  member: AccountabilitySummaryExport["items"][number] | null;
  outcome: PlenarySeatOutcome;
};

export type PlenarySeatFilters = {
  party: string;
  query: string;
};

function getPartyBlock(party: string): number {
  if (party.includes("국민의힘")) {
    return 0;
  }

  if (party.includes("무소속")) {
    return 1;
  }

  if (party.includes("더불어민주당")) {
    return 2;
  }

  return 3;
}

function compareMembers(
  left: AccountabilitySummaryExport["items"][number],
  right: AccountabilitySummaryExport["items"][number]
): number {
  const blockDifference =
    getPartyBlock(left.party) - getPartyBlock(right.party);
  if (blockDifference !== 0) {
    return blockDifference;
  }

  const partyDifference = left.party.localeCompare(right.party, "ko-KR");
  if (partyDifference !== 0) {
    return partyDifference;
  }

  return left.name.localeCompare(right.name, "ko-KR");
}

function normalizeMemberName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

function getVoteEntryKeys(entry: {
  memberId?: string | null;
  memberName: string;
}): string[] {
  return [
    ...(entry.memberId ? [`id:${entry.memberId}`] : []),
    `name:${normalizeMemberName(entry.memberName)}`
  ];
}

function getMemberKeys(
  member: AccountabilitySummaryExport["items"][number]
): string[] {
  return [
    ...(member.memberId ? [`id:${member.memberId}`] : []),
    `name:${normalizeMemberName(member.name)}`
  ];
}

export function buildPlenarySeatPositions(): PlenarySeatPosition[] {
  const positions: PlenarySeatPosition[] = [];
  let seatNumber = 1;

  PLENARY_ROW_COUNTS.forEach((rowCount, rowIndex) => {
    const rowProgress = rowIndex / Math.max(PLENARY_ROW_COUNTS.length - 1, 1);
    const radiusX = 22 + rowProgress * 27;
    const radiusY = 15 + rowProgress * 71;
    const startAngle = 18;
    const endAngle = 162;

    for (let rowSeatIndex = 0; rowSeatIndex < rowCount; rowSeatIndex += 1) {
      const seatProgress = rowCount === 1 ? 0.5 : rowSeatIndex / (rowCount - 1);
      const angle =
        (startAngle + (endAngle - startAngle) * seatProgress) * (Math.PI / 180);

      positions.push({
        seatNumber,
        rowIndex,
        rowSeatIndex,
        xPercent: 50 + Math.cos(angle) * radiusX,
        yPercent: 4 + Math.sin(angle) * radiusY
      });
      seatNumber += 1;
    }
  });

  return positions;
}

export function matchesPlenarySeatFilters(
  assignment: PlenarySeatAssignment,
  filters: PlenarySeatFilters
): boolean {
  if (!assignment.member) {
    return filters.party === "all" && filters.query.trim() === "";
  }

  if (filters.party !== "all" && assignment.member.party !== filters.party) {
    return false;
  }

  const normalizedQuery = filters.query
    .trim()
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "");

  if (!normalizedQuery) {
    return true;
  }

  return [
    assignment.member.name,
    assignment.member.party,
    assignment.member.district ?? "비례대표"
  ]
    .join(" ")
    .toLocaleLowerCase("ko-KR")
    .replace(/\s+/g, "")
    .includes(normalizedQuery);
}

export function buildPlenarySeatAssignments(args: {
  members: AccountabilitySummaryExport["items"];
  vote: LatestVoteItem;
}): PlenarySeatAssignment[] {
  const outcomeByMemberKey = new Map<string, PlenarySeatOutcome>();

  (args.vote.memberVotes ?? []).forEach((entry) => {
    if (
      entry.voteCode === "yes" ||
      entry.voteCode === "no" ||
      entry.voteCode === "abstain" ||
      entry.voteCode === "absent"
    ) {
      const outcome: PlenarySeatOutcome = entry.voteCode;
      getVoteEntryKeys(entry).forEach((key) => {
        outcomeByMemberKey.set(key, outcome);
      });
    }
  });
  args.vote.highlightedVotes.forEach((entry) => {
    const keys = getVoteEntryKeys(entry);
    if (
      !keys.some((key) => outcomeByMemberKey.has(key)) &&
      (entry.voteCode === "no" || entry.voteCode === "abstain")
    ) {
      const outcome: PlenarySeatOutcome = entry.voteCode;
      keys.forEach((key) => {
        outcomeByMemberKey.set(key, outcome);
      });
    }
  });
  args.vote.absentVotes.forEach((entry) => {
    const keys = getVoteEntryKeys(entry);
    if (!keys.some((key) => outcomeByMemberKey.has(key))) {
      keys.forEach((key) => {
        outcomeByMemberKey.set(key, "absent");
      });
    }
  });

  const sortedMembers = [...args.members].sort(compareMembers);
  const positions = buildPlenarySeatPositions();

  return positions.map((position, index) => {
    const member = sortedMembers[index] ?? null;
    return {
      ...position,
      member,
      outcome: member
        ? (getMemberKeys(member)
            .map((key) => outcomeByMemberKey.get(key))
            .find((outcome) => outcome !== undefined) ?? "unlinked")
        : "vacant"
    };
  });
}

export function countLinkedSeatOutcomes(
  assignments: PlenarySeatAssignment[]
): Record<Exclude<PlenarySeatOutcome, "vacant">, number> {
  return assignments.reduce(
    (counts, assignment) => {
      if (assignment.outcome !== "vacant") {
        counts[assignment.outcome] += 1;
      }
      return counts;
    },
    {
      yes: 0,
      no: 0,
      abstain: 0,
      absent: 0,
      unlinked: 0
    }
  );
}
