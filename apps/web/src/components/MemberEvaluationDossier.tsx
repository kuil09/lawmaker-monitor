import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { BuildingsIcon } from "@phosphor-icons/react/dist/csr/Buildings";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { GavelIcon } from "@phosphor-icons/react/dist/csr/Gavel";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { QuestionIcon } from "@phosphor-icons/react/dist/csr/Question";
import { ShareNetworkIcon } from "@phosphor-icons/react/dist/csr/ShareNetwork";
import { WarningDiamondIcon } from "@phosphor-icons/react/dist/csr/WarningDiamond";
import { useMemo, useState } from "react";

import { MemberIdentity } from "./MemberIdentity.js";
import {
  formatAssetEok,
  formatAssetEokDelta,
  formatDate,
  formatNumber,
  formatPercent,
  formatVoteCodeLabel
} from "../lib/format.js";

import type {
  AccountabilityMoverWindow,
  AccountabilitySummaryItem,
  AccountabilityTrendsExport,
  BillProposalActivityItem,
  MemberActivityCalendarAssembly,
  MemberActivityCalendarMember,
  MemberActivityVoteRecord,
  MemberAssetsHistoryExport,
  MemberAssetsIndexItem
} from "@lawmaker-monitor/schemas";
import type { KeyboardEvent, ReactNode } from "react";

export type MemberEvaluationQuestion =
  | "participation"
  | "party-line"
  | "change";

export type MemberEvaluationShareState = "idle" | "working" | "done" | "error";

export type MemberEvaluationDossierProps = {
  assembly: MemberActivityCalendarAssembly;
  member: MemberActivityCalendarMember;
  accountabilityItem?: AccountabilitySummaryItem | null;
  accountabilityMover?: AccountabilityMoverWindow | null;
  accountabilityTrends?: AccountabilityTrendsExport | null;
  billItem?: BillProposalActivityItem | null;
  billOutcomeDataAvailable?: boolean;
  billDataLoaded?: boolean;
  billDataError?: string | null;
  assetIndex?: MemberAssetsIndexItem | null;
  assetHistory?: MemberAssetsHistoryExport | null;
  assetHistoryLoading?: boolean;
  assetHistoryError?: string | null;
  voteRecords: MemberActivityVoteRecord[];
  voteRecordCount: number;
  voteRecordsLoading: boolean;
  voteRecordsError: string | null;
  resolvedDistrict: string | null | undefined;
  officialUrl?: string | null;
  onOfficialOpen?: (url: string) => void;
  onShare: () => void;
  shareState?: MemberEvaluationShareState;
  activeQuestion?: MemberEvaluationQuestion;
  onQuestionChange?: (question: MemberEvaluationQuestion) => void;
};

type EvidenceItem = {
  id: string;
  label: string;
  value: string;
  detail: string;
  status: string;
  href?: string;
};

type LedgerRow = {
  id: string;
  indicator: string;
  previous: string;
  latest: string;
  change: string;
  denominator: string;
  source: string;
};

const questionOptions: Array<{
  id: MemberEvaluationQuestion;
  label: string;
  heading: string;
  description: string;
}> = [
  {
    id: "participation",
    label: "국회 일에 꾸준히 참여했나?",
    heading: "본회의 표결 참여는 어떻게 달라졌나?",
    description:
      "직전 관찰 구간과 최근 관찰 구간의 참여·불참 기록을 같은 방식으로 비교합니다."
  },
  {
    id: "party-line",
    label: "정당과 다른 판단을 한 적이 있나?",
    heading: "같은 정당 참여 의원 다수와 다른 표결은 어떻게 달라졌나?",
    description:
      "같은 정당 참여 의원 다수 기준이 성립하고 의원 표결이 확인된 건만 비교합니다. 다르다는 사실이 곧 옳고 그름을 뜻하지는 않습니다."
  },
  {
    id: "change",
    label: "재산·발의 기록은 어떻게 달라졌나?",
    heading: "공개 재산과 법안 발의 기록은 무엇을 보여주나?",
    description:
      "신고액 변화와 현재 공개된 발의 건수를 나눠 봅니다. 변화의 원인은 원문 확인 전까지 단정하지 않습니다."
  }
];

function formatRatio(
  numerator: number,
  denominator: number,
  emptyLabel = "비교 자료 없음"
): string {
  if (denominator <= 0) {
    return emptyLabel;
  }

  return `${formatNumber(numerator)} / ${formatNumber(denominator)} (${formatPercent(
    numerator / denominator
  )})`;
}

function formatRatePointChange(
  previousNumerator: number,
  previousDenominator: number,
  currentNumerator: number,
  currentDenominator: number
): string {
  if (previousDenominator <= 0 || currentDenominator <= 0) {
    return "비교 불가";
  }

  const difference =
    currentNumerator / currentDenominator -
    previousNumerator / previousDenominator;
  if (Math.abs(difference) < 0.0005) {
    return "비율 변화 없음";
  }

  const sign = difference > 0 ? "+" : "";
  return `${sign}${(difference * 100).toFixed(1)}%p`;
}

function formatCountChange(previous: number, current: number): string {
  const difference = current - previous;
  if (difference === 0) {
    return "건수 변화 없음";
  }

  return `${difference > 0 ? "+" : ""}${formatNumber(difference)}건`;
}

function getResolvedRegionLabel(
  resolvedDistrict: string | null | undefined
): string {
  if (typeof resolvedDistrict === "string" && resolvedDistrict.trim()) {
    return resolvedDistrict.trim();
  }
  return "지역 정보 미확인";
}

function getShareLabel(state: MemberEvaluationShareState): string {
  if (state === "working") {
    return "공유 중";
  }
  if (state === "done") {
    return "링크 복사됨";
  }
  if (state === "error") {
    return "다시 공유";
  }
  return "공유";
}

function EvidenceColumn({
  tone,
  icon,
  title,
  description,
  items
}: {
  tone: "confirmed" | "review" | "hold";
  icon: ReactNode;
  title: string;
  description: string;
  items: EvidenceItem[];
}) {
  return (
    <article
      className={`member-evaluation__evidence-column member-evaluation__evidence-column--${tone}`}
    >
      <header className="member-evaluation__evidence-heading">
        <span className="member-evaluation__evidence-icon" aria-hidden="true">
          {icon}
        </span>
        <span>
          <h3>{title}</h3>
          <p>{description}</p>
        </span>
      </header>
      <div className="member-evaluation__evidence-list">
        {items.map((item) => (
          <div className="member-evaluation__evidence-item" key={item.id}>
            <div>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
            <p>{item.detail}</p>
            <footer>
              <small>{item.status}</small>
              {item.href ? (
                <a href={item.href}>
                  자세히
                  <ArrowRightIcon size={15} weight="bold" aria-hidden="true" />
                </a>
              ) : null}
            </footer>
          </div>
        ))}
      </div>
    </article>
  );
}

function LedgerTable({
  rows,
  emptyMessage
}: {
  rows: LedgerRow[];
  emptyMessage: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="member-evaluation__empty-state">
        <InfoIcon size={20} weight="fill" aria-hidden="true" />
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="member-evaluation__table-scroll" tabIndex={0}>
      <table className="member-evaluation__ledger">
        <thead>
          <tr>
            <th scope="col">지표</th>
            <th scope="col">직전 상태</th>
            <th scope="col" aria-label="변경 방향" />
            <th scope="col">최근 상태</th>
            <th scope="col">변화</th>
            <th scope="col">분모·기준</th>
            <th scope="col">출처</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.indicator}</th>
              <td>{row.previous}</td>
              <td className="member-evaluation__ledger-arrow">
                <ArrowRightIcon size={17} weight="bold" aria-hidden="true" />
              </td>
              <td>{row.latest}</td>
              <td>{row.change}</td>
              <td>{row.denominator}</td>
              <td>{row.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MemberEvaluationDossier({
  assembly,
  member,
  accountabilityItem = null,
  accountabilityMover = null,
  accountabilityTrends = null,
  billItem = null,
  billOutcomeDataAvailable = false,
  billDataLoaded = true,
  billDataError = null,
  assetIndex = null,
  assetHistory = null,
  assetHistoryLoading = false,
  assetHistoryError = null,
  voteRecords,
  voteRecordCount,
  voteRecordsLoading,
  voteRecordsError,
  resolvedDistrict,
  officialUrl,
  onOfficialOpen,
  onShare,
  shareState = "idle",
  activeQuestion: controlledQuestion,
  onQuestionChange
}: MemberEvaluationDossierProps) {
  const [internalQuestion, setInternalQuestion] =
    useState<MemberEvaluationQuestion>("participation");
  const activeQuestion = controlledQuestion ?? internalQuestion;
  const profile =
    member.profile ?? accountabilityItem?.profile ?? assetIndex?.profile;
  const resolvedAccountabilityMover =
    accountabilityMover ??
    accountabilityTrends?.movers.find(
      (mover) => mover.memberId === member.memberId
    ) ??
    null;
  const previousTrendWeeks = accountabilityTrends?.weeks.slice(-8, -4) ?? [];
  const currentTrendWeeks = accountabilityTrends?.weeks.slice(-4) ?? [];
  const previousWindowPeriod =
    previousTrendWeeks.length > 0
      ? `${formatDate(previousTrendWeeks[0]!.weekStart)} – ${formatDate(
          previousTrendWeeks.at(-1)!.weekEnd
        )}`
      : "직전 관찰 구간 날짜 미확인";
  const currentWindowPeriod =
    currentTrendWeeks.length > 0
      ? `${formatDate(currentTrendWeeks[0]!.weekStart)} – ${formatDate(
          currentTrendWeeks.at(-1)!.weekEnd
        )}`
      : "최근 관찰 구간 날짜 미확인";
  const resolvedOfficialUrl =
    officialUrl ??
    member.officialExternalUrl ??
    member.officialProfileUrl ??
    accountabilityItem?.officialExternalUrl ??
    accountabilityItem?.officialProfileUrl ??
    assetIndex?.officialExternalUrl ??
    assetIndex?.officialProfileUrl ??
    null;
  const regionLabel = getResolvedRegionLabel(resolvedDistrict);
  const committeeNames = Array.from(
    new Set(
      [
        profile?.representativeCommitteeName,
        profile?.affiliatedCommitteeName,
        ...member.committeeMemberships
      ]
        .flatMap((value) => value?.split(/[,\n]/) ?? [])
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
  const observationDate = accountabilityItem?.lastVoteAt
    ? formatDate(accountabilityItem.lastVoteAt)
    : "최근 표결일 미확인";
  const latestAssetSummary =
    assetHistory?.latestSummary ?? assetIndex?.latestSummary ?? null;
  const assetSeries = assetHistory?.series ?? [];
  const latestAssetPoint = assetSeries.at(-1) ?? null;
  const previousAssetPoint =
    assetSeries.length >= 2 ? (assetSeries.at(-2) ?? null) : null;
  const participatedVoteCount = accountabilityItem
    ? Math.max(
        0,
        accountabilityItem.totalRecordedVotes - accountabilityItem.absentCount
      )
    : null;

  const confirmedItems = useMemo<EvidenceItem[]>(() => {
    const items: EvidenceItem[] = [];
    if (accountabilityItem && participatedVoteCount !== null) {
      items.push({
        id: "plenary-participation",
        label: "공개 기록표결 참여율",
        value: formatRatio(
          participatedVoteCount,
          accountabilityItem.totalRecordedVotes,
          "산정 가능한 기록표결 없음"
        ),
        detail: `관찰 기간 ${formatDate(assembly.startDate)} – ${observationDate}`,
        status: "분모: 의원별 참여 대상 공개 기록표결",
        href: "#member-votes"
      });
    } else {
      items.push({
        id: "plenary-participation-missing",
        label: "공개 기록표결 참여율",
        value: "집계 자료 없음",
        detail: `${assembly.label} 참여 분모와 건수를 확인할 수 없습니다.`,
        status: "데이터 상태: 미확인"
      });
    }

    if (billItem) {
      items.push({
        id: "lead-proposals",
        label: "대표발의",
        value: `${formatNumber(billItem.leadProposalCount)}건`,
        detail: `공동발의 참여 ${formatNumber(
          billItem.coSponsorProposalCount
        )}건 · 전체 ${formatNumber(billItem.totalProposalCount)}건`,
        status: billItem.latestProposalAt
          ? `최근 발의 ${formatDate(billItem.latestProposalAt)}`
          : "최근 발의일 미확인"
      });
    } else {
      items.push({
        id: "lead-proposals-missing",
        label: "법안 발의",
        value: !billDataLoaded
          ? "불러오는 중"
          : billDataError
            ? "불러오지 못함"
            : "연결 자료 없음",
        detail: !billDataLoaded
          ? "발의 집계를 불러오고 있습니다."
          : billDataError
            ? billDataError
            : "의원 식별자와 연결된 발의 집계를 확인할 수 없습니다.",
        status: !billDataLoaded
          ? "데이터 상태: 로딩"
          : billDataError
            ? "데이터 상태: 오류"
            : "데이터 상태: 미확인"
      });
    }

    if (committeeNames.length > 0) {
      items.push({
        id: "committee-membership",
        label: "소속 위원회",
        value: `${formatNumber(committeeNames.length)}곳`,
        detail: committeeNames.join(", "),
        status: `기준: ${assembly.label} 공개 소속 정보`,
        href: "#member-committees"
      });
    }

    return items;
  }, [
    accountabilityItem,
    assembly.label,
    assembly.startDate,
    billDataError,
    billDataLoaded,
    billItem,
    committeeNames,
    observationDate,
    participatedVoteCount
  ]);

  const reviewItems = useMemo<EvidenceItem[]>(() => {
    if (!accountabilityItem) {
      return [
        {
          id: "review-missing",
          label: "추가 확인할 표결 기록",
          value: "집계 자료 없음",
          detail: "불참·반대·기권 건수를 같은 분모로 확인할 수 없습니다.",
          status: "데이터 상태: 미확인"
        }
      ];
    }

    const items: EvidenceItem[] = [
      {
        id: "absence",
        label: "본회의 기록표결 불참",
        value: formatRatio(
          accountabilityItem.absentCount,
          accountabilityItem.totalRecordedVotes,
          "산정 가능한 기록표결 없음"
        ),
        detail:
          "불참 사유는 표결 기록만으로 알 수 없어 원문·공식 설명 확인이 필요합니다.",
        status: `분모: 기록표결 ${formatNumber(
          accountabilityItem.totalRecordedVotes
        )}건`,
        href: "#member-votes"
      },
      {
        id: "no-votes",
        label: "반대 표결",
        value: formatRatio(
          accountabilityItem.noCount,
          accountabilityItem.totalRecordedVotes,
          "산정 가능한 기록표결 없음"
        ),
        detail: "반대 여부는 의안별 판단 기록이며 평가 점수가 아닙니다.",
        status: `분모: 기록표결 ${formatNumber(
          accountabilityItem.totalRecordedVotes
        )}건`,
        href: "#member-votes"
      },
      {
        id: "abstain-votes",
        label: "기권 표결",
        value: formatRatio(
          accountabilityItem.abstainCount,
          accountabilityItem.totalRecordedVotes,
          "산정 가능한 기록표결 없음"
        ),
        detail: "기권 여부도 의안별 판단 기록이며 평가 점수가 아닙니다.",
        status: `분모: 기록표결 ${formatNumber(
          accountabilityItem.totalRecordedVotes
        )}건`,
        href: "#member-votes"
      }
    ];

    if (accountabilityItem.partyLineParticipationCount > 0) {
      items.push({
        id: "party-line",
        label: "같은 정당 참여 의원 다수와 다른 표결",
        value: formatRatio(
          accountabilityItem.partyLineDefectionCount,
          accountabilityItem.partyLineParticipationCount,
          "비교 가능한 참여 표결 없음"
        ),
        detail:
          "같은 정당 참여 의원 다수와 다르다는 사실은 찬반의 옳고 그름을 뜻하지 않습니다.",
        status: `분모: 비교 가능한 표결 ${formatNumber(
          accountabilityItem.partyLineParticipationCount
        )}건`
      });
    }

    return items;
  }, [accountabilityItem]);

  const holdItems = useMemo<EvidenceItem[]>(() => {
    const items: EvidenceItem[] = [];

    if (!billItem) {
      items.push({
        id: "bill-outcome-missing",
        label: "대표발의 처리 결과",
        value: !billDataLoaded
          ? "불러오는 중"
          : billDataError
            ? "불러오지 못함"
            : "연결 자료 없음",
        detail: !billDataLoaded
          ? "발의 처리 결과를 불러오고 있습니다."
          : billDataError
            ? billDataError
            : "의원 식별자와 연결된 발의·처리 결과를 확인할 수 없습니다.",
        status: !billDataLoaded
          ? "데이터 상태: 로딩"
          : billDataError
            ? "데이터 상태: 오류"
            : "데이터 상태: 미확인"
      });
    } else if (!billOutcomeDataAvailable) {
      items.push({
        id: "bill-outcome-unavailable",
        label: "대표발의 처리 결과",
        value: "집계 준비 중",
        detail:
          "발의 건수는 확인됐지만 처리 결과 전체가 공개 집계에 포함되지 않았습니다.",
        status: "판단 보류: 결과 데이터 미제공"
      });
    } else {
      items.push({
        id: "bill-outcome-partial",
        label: "대표발의 결과 확인 범위",
        value: `${formatNumber(
          billItem.leadResultAvailableProposalCount
        )} / ${formatNumber(billItem.leadProposalCount)}건`,
        detail: `확인 범위 중 가결 ${formatNumber(
          billItem.leadPassedProposalCount
        )}건 · 대안반영 ${formatNumber(
          billItem.leadAlternativeReflectedProposalCount
        )}건`,
        status: "분모: 처리 결과가 연결된 대표발의"
      });
    }

    if (latestAssetPoint && previousAssetPoint) {
      items.push({
        id: "asset-change",
        label: "공개 재산 신고액 변화",
        value: formatAssetEokDelta(
          latestAssetPoint.currentAmount - previousAssetPoint.currentAmount
        ),
        detail: `${formatAssetEok(
          previousAssetPoint.currentAmount
        )} (${formatDate(previousAssetPoint.reportedAt)}) → ${formatAssetEok(
          latestAssetPoint.currentAmount
        )} (${formatDate(latestAssetPoint.reportedAt)})`,
        status: "동일 의원의 연속 공개 신고 · 원인 단정 불가",
        href: "#member-assets"
      });
    } else if (latestAssetSummary) {
      items.push({
        id: "asset-latest-only",
        label: "최신 공개 재산 신고액",
        value: formatAssetEok(latestAssetSummary.currentAmount),
        detail: `신고 기준일 ${formatDate(latestAssetSummary.reportedAt)}`,
        status: assetHistoryLoading
          ? "이전 신고 이력을 불러오는 중"
          : assetHistoryError
            ? "이전 신고 이력을 불러오지 못해 변화 비교 보류"
            : "이전 신고 기준일이 없어 변화 비교 보류",
        href: "#member-assets"
      });
    } else {
      items.push({
        id: "asset-change-missing",
        label: "공개 재산 신고액 변화",
        value: "비교 자료 없음",
        detail: "같은 기준으로 이전·최신 신고액을 비교할 수 없습니다.",
        status: "데이터 상태: 미확인"
      });
    }

    if (!accountabilityItem?.partyLineParticipationCount) {
      items.push({
        id: "party-line-missing",
        label: "같은 정당 참여 의원 다수와 다른 표결",
        value: "비교 자료 없음",
        detail: "정당 다수 기준과 의원 표결이 함께 확인된 건이 없습니다.",
        status: "판단 보류: 비교 분모 없음"
      });
    }

    return items;
  }, [
    accountabilityItem,
    assetHistoryError,
    assetHistoryLoading,
    billDataError,
    billDataLoaded,
    billItem,
    billOutcomeDataAvailable,
    latestAssetPoint,
    latestAssetSummary,
    previousAssetPoint
  ]);

  const activeRows = useMemo<LedgerRow[]>(() => {
    if (activeQuestion === "change") {
      if (!latestAssetPoint || !previousAssetPoint) {
        return [];
      }
      return [
        {
          id: "asset-ledger",
          indicator: "공개 재산 신고액",
          previous: `${formatAssetEok(
            previousAssetPoint.currentAmount
          )} · ${formatDate(previousAssetPoint.reportedAt)}`,
          latest: `${formatAssetEok(
            latestAssetPoint.currentAmount
          )} · ${formatDate(latestAssetPoint.reportedAt)}`,
          change: formatAssetEokDelta(
            latestAssetPoint.currentAmount - previousAssetPoint.currentAmount
          ),
          denominator: "공개 신고 총액 · 천원 단위 원자료",
          source: "국회공직자윤리위원회 공개 재산"
        }
      ];
    }

    if (!resolvedAccountabilityMover) {
      return [];
    }

    if (activeQuestion === "party-line") {
      const previousDenominator =
        resolvedAccountabilityMover.previousWindowPartyLineParticipationCount;
      const currentDenominator =
        resolvedAccountabilityMover.currentWindowPartyLineParticipationCount;
      if (previousDenominator <= 0 || currentDenominator <= 0) {
        return [];
      }
      return [
        {
          id: "party-line-ledger",
          indicator: "같은 정당 참여 의원 다수와 다른 표결",
          previous: formatRatio(
            resolvedAccountabilityMover.previousWindowPartyLineDefectionCount,
            previousDenominator,
            "비교 가능한 참여 표결 없음"
          ),
          latest: formatRatio(
            resolvedAccountabilityMover.currentWindowPartyLineDefectionCount,
            currentDenominator,
            "비교 가능한 참여 표결 없음"
          ),
          change: formatRatePointChange(
            resolvedAccountabilityMover.previousWindowPartyLineDefectionCount,
            previousDenominator,
            resolvedAccountabilityMover.currentWindowPartyLineDefectionCount,
            currentDenominator
          ),
          denominator: `${previousWindowPeriod} · ${formatNumber(
            previousDenominator
          )}건 / ${currentWindowPeriod} · ${formatNumber(
            currentDenominator
          )}건`,
          source: "국회 공개 표결·같은 정당 참여 의원 다수 기준"
        }
      ];
    }

    const previousParticipation = Math.max(
      0,
      resolvedAccountabilityMover.previousWindowEligibleCount -
        resolvedAccountabilityMover.previousWindowAbsentCount
    );
    const currentParticipation = Math.max(
      0,
      resolvedAccountabilityMover.currentWindowEligibleCount -
        resolvedAccountabilityMover.currentWindowAbsentCount
    );
    if (
      resolvedAccountabilityMover.previousWindowEligibleCount <= 0 ||
      resolvedAccountabilityMover.currentWindowEligibleCount <= 0
    ) {
      return [];
    }

    return [
      {
        id: "participation-ledger",
        indicator: "공개 기록표결 참여율",
        previous: formatRatio(
          previousParticipation,
          resolvedAccountabilityMover.previousWindowEligibleCount,
          "산정 가능한 기록표결 없음"
        ),
        latest: formatRatio(
          currentParticipation,
          resolvedAccountabilityMover.currentWindowEligibleCount,
          "산정 가능한 기록표결 없음"
        ),
        change: formatRatePointChange(
          previousParticipation,
          resolvedAccountabilityMover.previousWindowEligibleCount,
          currentParticipation,
          resolvedAccountabilityMover.currentWindowEligibleCount
        ),
        denominator: `${previousWindowPeriod} · ${formatNumber(
          resolvedAccountabilityMover.previousWindowEligibleCount
        )}건 / ${currentWindowPeriod} · ${formatNumber(
          resolvedAccountabilityMover.currentWindowEligibleCount
        )}건`,
        source: "국회 공개 표결 기록 집계"
      },
      {
        id: "absence-ledger",
        indicator: "본회의 기록표결 불참",
        previous: formatRatio(
          resolvedAccountabilityMover.previousWindowAbsentCount,
          resolvedAccountabilityMover.previousWindowEligibleCount,
          "산정 가능한 기록표결 없음"
        ),
        latest: formatRatio(
          resolvedAccountabilityMover.currentWindowAbsentCount,
          resolvedAccountabilityMover.currentWindowEligibleCount,
          "산정 가능한 기록표결 없음"
        ),
        change: `${formatCountChange(
          resolvedAccountabilityMover.previousWindowAbsentCount,
          resolvedAccountabilityMover.currentWindowAbsentCount
        )} · ${formatRatePointChange(
          resolvedAccountabilityMover.previousWindowAbsentCount,
          resolvedAccountabilityMover.previousWindowEligibleCount,
          resolvedAccountabilityMover.currentWindowAbsentCount,
          resolvedAccountabilityMover.currentWindowEligibleCount
        )}`,
        denominator: `${previousWindowPeriod} · ${formatNumber(
          resolvedAccountabilityMover.previousWindowEligibleCount
        )}건 / ${currentWindowPeriod} · ${formatNumber(
          resolvedAccountabilityMover.currentWindowEligibleCount
        )}건`,
        source: "국회 공개 표결 기록 집계"
      }
    ];
  }, [
    activeQuestion,
    currentWindowPeriod,
    latestAssetPoint,
    previousAssetPoint,
    previousWindowPeriod,
    resolvedAccountabilityMover
  ]);

  const latestOfficialRecords = useMemo(
    () =>
      [...voteRecords]
        .filter(
          (
            record
          ): record is MemberActivityVoteRecord & {
            officialSourceUrl: string;
          } => Boolean(record.officialSourceUrl)
        )
        .sort(
          (left, right) =>
            Date.parse(right.voteDatetime) - Date.parse(left.voteDatetime)
        )
        .slice(0, 3),
    [voteRecords]
  );
  const activeQuestionOption =
    questionOptions.find((option) => option.id === activeQuestion) ??
    questionOptions[0]!;
  const ledgerEmptyMessage =
    activeQuestion === "party-line"
      ? "직전 또는 최근 구간에 비교 가능한 참여 표결이 없어 증감을 표시하지 않습니다."
      : activeQuestion === "change"
        ? assetHistoryLoading
          ? "공개 재산 신고 이력을 불러오고 있습니다."
          : assetHistoryError
            ? "공개 재산 신고 이력을 불러오지 못해 변화를 비교하지 않습니다."
            : "날짜가 확인된 연속 두 차례의 공개 재산 신고가 없어 변화를 비교하지 않습니다."
        : "직전 또는 최근 구간에 산정 가능한 기록표결이 없어 증감을 표시하지 않습니다.";

  function handleQuestionChange(question: MemberEvaluationQuestion) {
    if (controlledQuestion === undefined) {
      setInternalQuestion(question);
    }
    onQuestionChange?.(question);
  }

  function handleQuestionKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) {
    const lastIndex = questionOptions.length - 1;
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = currentIndex === lastIndex ? 0 : currentIndex + 1;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = currentIndex === 0 ? lastIndex : currentIndex - 1;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = lastIndex;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextQuestion = questionOptions[nextIndex]!;
    handleQuestionChange(nextQuestion.id);
    document
      .getElementById(`member-evaluation-tab-${nextQuestion.id}`)
      ?.focus();
  }

  return (
    <section
      className="member-evaluation"
      aria-labelledby="member-evaluation-title"
    >
      <div className="member-evaluation__masthead">
        <div className="member-evaluation__portrait">
          <MemberIdentity
            name={member.name}
            party={member.party}
            photoUrl={member.photoUrl}
            size="large"
            showParty={false}
            avatarVariant="activity-card"
          />
        </div>

        <div className="member-evaluation__identity-copy">
          <div className="member-evaluation__name-row">
            <p className="member-evaluation__member-name">{member.name}</p>
            <span>{member.party}</span>
          </div>
          <p className="member-evaluation__role">
            {[profile?.reelectionLabel, assembly.label]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="member-evaluation__committees">
            <BuildingsIcon size={19} weight="fill" aria-hidden="true" />
            <span>
              <strong>소속 위원회</strong>{" "}
              {committeeNames.length > 0
                ? committeeNames.join(", ")
                : "공개 소속 정보 미확인"}
            </span>
          </p>
        </div>

        <div className="member-evaluation__identity-actions">
          {resolvedOfficialUrl ? (
            <a
              href={resolvedOfficialUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => onOfficialOpen?.(resolvedOfficialUrl)}
            >
              의원 페이지
              <ArrowSquareOutIcon size={17} weight="bold" aria-hidden="true" />
            </a>
          ) : (
            <span className="member-evaluation__action-unavailable">
              의원 페이지 미확인
            </span>
          )}
          <button
            type="button"
            onClick={onShare}
            disabled={shareState === "working"}
            aria-live="polite"
          >
            <ShareNetworkIcon size={18} weight="bold" aria-hidden="true" />
            {getShareLabel(shareState)}
          </button>
        </div>

        <dl className="member-evaluation__identity-facts">
          <div>
            <dt>
              <CalendarBlankIcon size={19} weight="bold" aria-hidden="true" />
              표결 관찰 기간
            </dt>
            <dd>
              {formatDate(assembly.startDate)} – {formatDate(assembly.endDate)}
            </dd>
          </div>
          <div>
            <dt>
              <MapPinIcon size={19} weight="fill" aria-hidden="true" />
              지역
            </dt>
            <dd>{regionLabel}</dd>
          </div>
          <div>
            <dt>
              <GavelIcon size={19} weight="fill" aria-hidden="true" />
              기록 범위
            </dt>
            <dd>{assembly.label} 공개 데이터</dd>
          </div>
        </dl>
      </div>

      <header className="member-evaluation__intro">
        <div>
          <h2 id="member-evaluation-title">
            공개 기록으로 판단하는 {member.name} 의원
          </h2>
          <p>
            국회의 공개된 사실을 같은 기준으로 정리합니다. 판단은 시민의
            몫입니다.
          </p>
        </div>
        <span>
          <InfoIcon size={17} weight="fill" aria-hidden="true" />
          기준: {observationDate}
        </span>
      </header>

      <div className="member-evaluation__evidence-grid">
        <EvidenceColumn
          tone="confirmed"
          icon={<CheckCircleIcon size={27} weight="fill" />}
          title="확인된 참여"
          description="공개 기록으로 건수와 분모가 확인된 사실"
          items={confirmedItems}
        />
        <EvidenceColumn
          tone="review"
          icon={<WarningDiamondIcon size={27} weight="fill" />}
          title="따져볼 기록"
          description="의안별 맥락과 공식 설명을 함께 볼 사실"
          items={reviewItems}
        />
        <EvidenceColumn
          tone="hold"
          icon={<QuestionIcon size={27} weight="fill" />}
          title="판단 보류"
          description="자료가 없거나 원인 확인이 더 필요한 항목"
          items={holdItems}
        />
      </div>

      <div
        className="member-evaluation__question-tabs"
        role="tablist"
        aria-label={`${member.name} 의원을 판단할 질문`}
      >
        {questionOptions.map((option, index) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            id={`member-evaluation-tab-${option.id}`}
            aria-controls="member-evaluation-question-panel"
            aria-selected={activeQuestion === option.id}
            tabIndex={activeQuestion === option.id ? 0 : -1}
            onClick={() => handleQuestionChange(option.id)}
            onKeyDown={(event) => handleQuestionKeyDown(event, index)}
          >
            <span>{index + 1}.</span> {option.label}
          </button>
        ))}
      </div>

      <section
        className="member-evaluation__question-panel"
        role="tabpanel"
        id="member-evaluation-question-panel"
        aria-labelledby={`member-evaluation-tab-${activeQuestion}`}
      >
        <header>
          <div>
            <p>
              <ClockCounterClockwiseIcon
                size={18}
                weight="bold"
                aria-hidden="true"
              />
              이전 → 최신
            </p>
            <h3>{activeQuestionOption.heading}</h3>
            <span>{activeQuestionOption.description}</span>
          </div>
          <small>같은 지표의 공개 집계만 비교</small>
        </header>
        <LedgerTable rows={activeRows} emptyMessage={ledgerEmptyMessage} />
        {activeQuestion === "change" && billItem ? (
          <div className="member-evaluation__bill-context">
            <FileTextIcon size={21} weight="fill" aria-hidden="true" />
            <p>
              <strong>현재 공개된 법안 발의 기록</strong>
              <span>
                대표발의 {formatNumber(billItem.leadProposalCount)}건 · 공동발의
                참여 {formatNumber(billItem.coSponsorProposalCount)}건
              </span>
            </p>
            <small>이전 구간 집계가 없어 변화량으로 표시하지 않습니다.</small>
          </div>
        ) : null}
      </section>

      <section
        className="member-evaluation__source-records"
        aria-labelledby="member-source-records-title"
      >
        <header>
          <div>
            <p>
              <FileTextIcon size={18} weight="fill" aria-hidden="true" />
              원문으로 검증
            </p>
            <h3 id="member-source-records-title">최근 공식 표결 근거</h3>
            <span>원문 링크가 연결된 기록 중 최근 3건을 먼저 보여줍니다.</span>
          </div>
          <div>
            <strong>총 {formatNumber(voteRecordCount)}건</strong>
            <a href="#member-votes">
              전체 기록 보기
              <ArrowRightIcon size={16} weight="bold" aria-hidden="true" />
            </a>
          </div>
        </header>

        {voteRecordsLoading ? (
          <div className="member-evaluation__record-state" aria-live="polite">
            표결 원문을 불러오는 중입니다.
          </div>
        ) : voteRecordsError ? (
          <div className="member-evaluation__record-state" role="alert">
            <WarningDiamondIcon size={19} weight="fill" aria-hidden="true" />
            <span>{voteRecordsError}</span>
          </div>
        ) : latestOfficialRecords.length === 0 ? (
          <div className="member-evaluation__record-state">
            원문 링크가 연결된 표결 기록이 아직 없습니다.
          </div>
        ) : (
          <div className="member-evaluation__table-scroll" tabIndex={0}>
            <table className="member-evaluation__records-table">
              <thead>
                <tr>
                  <th scope="col">일자</th>
                  <th scope="col">안건명</th>
                  <th scope="col">소관</th>
                  <th scope="col">{member.name} 의원 표결</th>
                  <th scope="col">출처</th>
                </tr>
              </thead>
              <tbody>
                {latestOfficialRecords.map((record) => (
                  <tr key={record.rollCallId}>
                    <td>{formatDate(record.voteDatetime)}</td>
                    <th scope="row">{record.billName}</th>
                    <td>{record.committeeName ?? "소관 미확인"}</td>
                    <td>
                      <span
                        className={`member-evaluation__vote-code member-evaluation__vote-code--${record.voteCode}`}
                      >
                        {formatVoteCodeLabel(record.voteCode)}
                      </span>
                    </td>
                    <td>
                      <a
                        href={record.officialSourceUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        국회 원문
                        <ArrowSquareOutIcon
                          size={15}
                          weight="bold"
                          aria-hidden="true"
                        />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="member-evaluation__source-note">
          <InfoIcon size={16} weight="fill" aria-hidden="true" />
          표결 결과는 의안의 가결·부결과 의원의 찬성·반대·기권·불참을 구분해
          표시합니다. 찬성 표결을 곧바로 긍정 평가로 해석하지 않습니다.
        </p>
      </section>
    </section>
  );
}
