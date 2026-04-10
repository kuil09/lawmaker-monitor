import type { SourceStatus, VoteCode, VoteVisibility } from "@lawmaker-monitor/schemas";

const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "long",
  timeStyle: "short"
});
const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  dateStyle: "long",
  timeZone: "Asia/Seoul"
});
const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: "Asia/Seoul"
});

const numberFormatter = new Intl.NumberFormat("ko-KR");
const percentFormatter = new Intl.NumberFormat("ko-KR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
});
const assetEokFormatter = new Intl.NumberFormat("ko-KR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

const ASSET_EOK_DIVISOR = 100_000;

const voteCodeLabels: Record<VoteCode, string> = {
  yes: "찬성",
  no: "반대",
  abstain: "기권",
  absent: "불참",
  invalid: "무효",
  unknown: "미확인"
};

const voteVisibilityLabels: Record<VoteVisibility, string> = {
  recorded: "기록표결",
  named: "기명표결",
  secret: "무기명",
  unknown: "공개 방식 미확인"
};

const sourceStatusLabels: Record<SourceStatus, string> = {
  confirmed: "확정",
  provisional: "잠정"
};

export function formatDateTime(value: string): string {
  try {
    return dateTimeFormatter.format(new Date(value));
  } catch {
    return value;
  }
}

export function formatDate(value: string): string {
  try {
    return dateFormatter.format(new Date(value));
  } catch {
    return value;
  }
}

export function getKoreanDateKey(value: string): string {
  try {
    return dayKeyFormatter.format(new Date(value));
  } catch {
    return value.slice(0, 10);
  }
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function convertThousandWonToEok(value: number): number {
  return value / ASSET_EOK_DIVISOR;
}

export function formatAssetEok(value: number): string {
  return `${assetEokFormatter.format(convertThousandWonToEok(value))}억원`;
}

export function formatAssetEokDelta(value: number): string {
  const converted = convertThousandWonToEok(value);
  const sign = converted > 0 ? "+" : "";
  return `${sign}${assetEokFormatter.format(converted)}억원`;
}

export function formatAssetEokMagnitude(value: number): string {
  return `${assetEokFormatter.format(Math.abs(convertThousandWonToEok(value)))}억원`;
}

export function formatAssetEokAxis(value: number): string {
  return `${assetEokFormatter.format(convertThousandWonToEok(value))}억`;
}

export function formatPercent(value: number): string {
  return percentFormatter.format(value);
}

export function formatVoteCodeLabel(value: VoteCode): string {
  return voteCodeLabels[value] ?? value;
}

export function formatVoteVisibilityLabel(value: VoteVisibility): string {
  return voteVisibilityLabels[value] ?? value;
}

export function formatSourceStatusLabel(value: SourceStatus): string {
  return sourceStatusLabels[value] ?? value;
}

export function isSameKoreanDay(left: string, right: Date = new Date()): boolean {
  try {
    return getKoreanDateKey(left) === dayKeyFormatter.format(right);
  } catch {
    return false;
  }
}
