import type {
  MemberRecord,
  MemberProfile,
  OfficialTally
} from "@lawmaker-monitor/schemas";

export type SourceContext = {
  sourceUrl: string;
  retrievedAt: string;
  snapshotId: string;
};

export type OfficialVoteParseOptions = {
  currentMembers?: MemberRecord[];
};

export type AgendaRecord = {
  meetingId?: string;
  agendaId?: string;
  billId?: string;
  billName: string;
  committeeName?: string;
  summary?: string;
};

export type LiveSignal = {
  isLive: boolean;
  title?: string;
  committeeName?: string;
};

export type CurrentAssemblyContext = {
  assemblyNo: number;
  label: string;
  unitCd: string;
};

export type MemberTenureRecord = {
  memberId: string;
  name: string;
  assemblyNo: number;
  unitCd?: string;
  startDate: string;
  endDate: string | null;
};

export type MemberInfoParseResult = {
  members: MemberRecord[];
  currentAssembly: Omit<CurrentAssemblyContext, "unitCd"> | null;
};

export type MemberProfileAllRecord = {
  naasCd: string;
  name: string;
  party: string;
  district: string | null;
  assemblyNo: number;
  committeeMemberships: string[];
  photoUrl: string | null;
  officialProfileUrl: string | null;
  officialExternalUrl: string | null;
  profile?: MemberProfile;
  proportionalFlag: boolean;
};

export type MemberProfileAllParseResult = {
  profiles: MemberProfileAllRecord[];
  currentAssembly: Omit<CurrentAssemblyContext, "unitCd"> | null;
};

export type CommitteeRosterRecord = {
  memberId: string;
  memberName: string;
  party: string | null;
  district: string | null;
  committeeName: string;
};

export type CommitteeOverviewRecord = {
  committeeName: string;
  committeeType: string | null;
  memberLimit: number | null;
  currentMemberCount: number | null;
};

export type BillVoteSummaryRecord = {
  billId: string;
  billNo: string;
  billName: string;
  committeeName: string | null;
  officialSourceUrl: string;
  officialTally: OfficialTally;
  summary: string | null;
};
