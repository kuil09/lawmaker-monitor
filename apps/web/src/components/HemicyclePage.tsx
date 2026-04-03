import { useMemo, useState } from "react";

import type { AccountabilitySummaryExport } from "@lawmaker-monitor/schemas";

import { formatNumber, formatPercent } from "../lib/format.js";

type HemicyclePageProps = {
  accountabilitySummary: AccountabilitySummaryExport | null;
  assemblyLabel: string;
  onBack: () => void;
  onSelectMember: (memberId: string) => void;
};

type SeatData = {
  memberId: string;
  name: string;
  party: string;
  district: string | null;
  photoUrl: string | null;
  attendanceRate: number;
  absentRate: number;
  totalRecordedVotes: number;
  noCount: number;
  abstainCount: number;
  absentCount: number;
};

type SeatPosition = {
  x: number;
  y: number;
  seat: SeatData;
};

const PARTY_COLORS: Record<string, string> = {
  "더불어민주당": "#3b82f6",
  "국민의힘": "#ef4444",
  "조국혁신당": "#60a5fa",
  "개혁신당": "#fb923c",
  "진보당": "#f43f5e",
  "사회민주당": "#a78bfa",
  "기본소득당": "#34d399",
  "무소속": "#94a3b8"
};

const SEAT_RADIUS = 8;
const SVG_WIDTH = 900;
const SVG_HEIGHT = 500;
const CENTER_X = SVG_WIDTH / 2;
const CENTER_Y = SVG_HEIGHT - 40;
const MIN_RADIUS = 100;
const ROW_GAP = 22;

function buildSeatPositions(seats: SeatData[]): SeatPosition[] {
  const count = seats.length;
  if (count === 0) return [];

  // Sort: party groups together, within party by attendance (worst first for outer rows)
  const partyOrder = [
    "더불어민주당", "조국혁신당", "진보당", "사회민주당", "기본소득당",
    "무소속",
    "개혁신당", "국민의힘"
  ];
  const sorted = [...seats].sort((a, b) => {
    const ai = partyOrder.indexOf(a.party);
    const bi = partyOrder.indexOf(b.party);
    const aIdx = ai >= 0 ? ai : partyOrder.length;
    const bIdx = bi >= 0 ? bi : partyOrder.length;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.attendanceRate - b.attendanceRate;
  });

  // Calculate rows: fill inner rows first
  const rows: SeatData[][] = [];
  let remaining = count;
  let rowRadius = MIN_RADIUS;
  while (remaining > 0) {
    const circumference = Math.PI * rowRadius;
    const maxSeats = Math.floor(circumference / (SEAT_RADIUS * 2.6));
    const seatsInRow = Math.min(maxSeats, remaining);
    rows.push([]);
    remaining -= seatsInRow;
    rowRadius += ROW_GAP;
  }

  // Distribute seats to rows
  let seatIdx = 0;
  for (const row of rows) {
    const rowCapacity = Math.floor((Math.PI * (MIN_RADIUS + rows.indexOf(row) * ROW_GAP)) / (SEAT_RADIUS * 2.6));
    const seatsInRow = Math.min(rowCapacity, sorted.length - seatIdx);
    for (let i = 0; i < seatsInRow; i++) {
      if (seatIdx < sorted.length) {
        row.push(sorted[seatIdx]!);
        seatIdx++;
      }
    }
  }

  // Position each seat along semicircle arc
  const positions: SeatPosition[] = [];
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx]!;
    const radius = MIN_RADIUS + rowIdx * ROW_GAP;
    const padding = 0.08; // rad padding from edges
    for (let i = 0; i < row.length; i++) {
      const angle = padding + ((Math.PI - 2 * padding) * i) / Math.max(row.length - 1, 1);
      positions.push({
        x: CENTER_X - radius * Math.cos(angle),
        y: CENTER_Y - radius * Math.sin(angle),
        seat: row[i]!
      });
    }
  }

  return positions;
}

function getSeatFill(seat: SeatData, mode: "attendance" | "party"): string {
  if (mode === "party") {
    return PARTY_COLORS[seat.party] ?? "#94a3b8";
  }

  // Attendance mode: green → yellow → red → very dark
  const rate = seat.attendanceRate;
  if (rate >= 0.9) return "#22c55e";
  if (rate >= 0.75) return "#84cc16";
  if (rate >= 0.6) return "#eab308";
  if (rate >= 0.4) return "#f97316";
  if (rate >= 0.2) return "#ef4444";
  return "#7f1d1d";
}

function getSeatOpacity(seat: SeatData, mode: "attendance" | "party"): number {
  if (mode === "party") return 0.85;
  // Lower attendance → more visible (darker/more saturated)
  return 0.5 + (1 - seat.attendanceRate) * 0.5;
}

export function HemicyclePage({
  accountabilitySummary,
  assemblyLabel,
  onBack,
  onSelectMember
}: HemicyclePageProps) {
  const [hoveredSeat, setHoveredSeat] = useState<SeatPosition | null>(null);
  const [selectedSeat, setSelectedSeat] = useState<SeatData | null>(null);
  const [colorMode, setColorMode] = useState<"attendance" | "party">("attendance");

  const seats: SeatData[] = useMemo(() => {
    if (!accountabilitySummary) return [];
    return accountabilitySummary.items.map((item) => {
      const totalVotes = item.totalRecordedVotes;
      const absentCount = item.absentCount;
      const attendanceRate = totalVotes > 0 ? (totalVotes - absentCount) / totalVotes : 1;
      return {
        memberId: item.memberId,
        name: item.name,
        party: item.party,
        district: item.district,
        photoUrl: item.photoUrl,
        attendanceRate,
        absentRate: totalVotes > 0 ? absentCount / totalVotes : 0,
        totalRecordedVotes: totalVotes,
        noCount: item.noCount,
        abstainCount: item.abstainCount,
        absentCount
      };
    });
  }, [accountabilitySummary]);

  const seatPositions = useMemo(() => buildSeatPositions(seats), [seats]);

  const absentCount = seats.filter((s) => s.attendanceRate < 0.5).length;
  const avgAttendance = seats.length > 0
    ? seats.reduce((sum, s) => sum + s.attendanceRate, 0) / seats.length
    : 0;

  if (!accountabilitySummary) {
    return (
      <div className="hemicycle-page">
        <div className="hemicycle-page__loading">
          <p>의석 데이터를 불러오는 중입니다.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="hemicycle-page">
      <div className="hemicycle-page__header">
        <div className="hemicycle-page__title-row">
          <button type="button" className="hemicycle-page__back" onClick={onBack}>← 홈</button>
          <div>
            <h1>본회의장</h1>
            <p className="hemicycle-page__subtitle">{assemblyLabel} · {formatNumber(seats.length)}석</p>
          </div>
        </div>
        <div className="hemicycle-page__stats">
          <div className="hemicycle-page__stat">
            <strong>{formatPercent(avgAttendance)}</strong>
            <span>평균 출석률</span>
          </div>
          <div className="hemicycle-page__stat hemicycle-page__stat--alert">
            <strong>{formatNumber(absentCount)}석</strong>
            <span>출석률 50% 미만</span>
          </div>
        </div>
        <div className="hemicycle-page__mode">
          <button
            type="button"
            className={colorMode === "attendance" ? "is-active" : ""}
            onClick={() => setColorMode("attendance")}
          >
            출석률
          </button>
          <button
            type="button"
            className={colorMode === "party" ? "is-active" : ""}
            onClick={() => setColorMode("party")}
          >
            정당
          </button>
        </div>
      </div>

      <div className="hemicycle-page__chamber">
        <svg
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          className="hemicycle-page__svg"
          role="img"
          aria-label="본회의장 의석 배치도"
        >
          {/* Podium */}
          <ellipse cx={CENTER_X} cy={CENTER_Y + 5} rx={55} ry={14} fill="#1e1b4b" opacity={0.6} />
          <text x={CENTER_X} y={CENTER_Y + 9} textAnchor="middle" fill="#a5b4fc" fontSize={9} fontWeight={700}>
            의장석
          </text>

          {/* Seats */}
          {seatPositions.map((pos) => {
            const isHovered = hoveredSeat?.seat.memberId === pos.seat.memberId;
            const isSelected = selectedSeat?.memberId === pos.seat.memberId;
            return (
              <g
                key={pos.seat.memberId}
                style={{ cursor: "pointer" }}
                onMouseEnter={() => setHoveredSeat(pos)}
                onMouseLeave={() => setHoveredSeat(null)}
                onClick={() => setSelectedSeat(pos.seat)}
              >
                {isSelected ? (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={SEAT_RADIUS + 3}
                    fill="none"
                    stroke="#e0e7ff"
                    strokeWidth={1.5}
                    opacity={0.8}
                  />
                ) : null}
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r={isHovered ? SEAT_RADIUS + 1 : SEAT_RADIUS}
                  fill={getSeatFill(pos.seat, colorMode)}
                  opacity={getSeatOpacity(pos.seat, colorMode)}
                  stroke={isHovered ? "#fff" : "rgba(0,0,0,0.3)"}
                  strokeWidth={isHovered ? 1.5 : 0.5}
                />
                {/* Dark center for low attendance = "empty seat" look */}
                {colorMode === "attendance" && pos.seat.attendanceRate < 0.3 ? (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={SEAT_RADIUS * 0.5}
                    fill="#0a0a0f"
                    opacity={0.6}
                    style={{ pointerEvents: "none" }}
                  />
                ) : null}
              </g>
            );
          })}
        </svg>

        {/* Hover tooltip */}
        {hoveredSeat ? (
          <div
            className="hemicycle-page__tooltip"
            style={{
              left: `${(hoveredSeat.x / SVG_WIDTH) * 100}%`,
              top: `${(hoveredSeat.y / SVG_HEIGHT) * 100 - 14}%`
            }}
          >
            <strong>{hoveredSeat.seat.name}</strong>
            <span>{hoveredSeat.seat.party}</span>
            <span>출석률 {formatPercent(hoveredSeat.seat.attendanceRate)}</span>
          </div>
        ) : null}

        {/* Attendance legend */}
        {colorMode === "attendance" ? (
          <div className="hemicycle-page__legend">
            <span>높은 출석</span>
            <div className="hemicycle-page__legend-bar" />
            <span>낮은 출석</span>
          </div>
        ) : (
          <div className="hemicycle-page__legend hemicycle-page__legend--party">
            {Object.entries(PARTY_COLORS).map(([party, hex]) => (
              <span key={party} className="hemicycle-page__legend-item">
                <i style={{ background: hex }} />
                {party}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Selected member detail */}
      {selectedSeat ? (
        <div className="hemicycle-page__detail">
          <button
            type="button"
            className="hemicycle-page__detail-close"
            onClick={() => setSelectedSeat(null)}
          >×</button>
          <div className="hemicycle-page__detail-identity">
            {selectedSeat.photoUrl ? (
              <img
                src={selectedSeat.photoUrl}
                alt=""
                className="hemicycle-page__detail-photo"
              />
            ) : (
              <div className="hemicycle-page__detail-photo hemicycle-page__detail-photo--fallback">
                {selectedSeat.name.slice(0, 1)}
              </div>
            )}
            <div>
              <strong>{selectedSeat.name}</strong>
              <span>{selectedSeat.party}</span>
              {selectedSeat.district ? <span className="hemicycle-page__detail-district">{selectedSeat.district}</span> : null}
            </div>
          </div>
          <div className="hemicycle-page__detail-metrics">
            <div>
              <span>출석률</span>
              <strong style={{ color: selectedSeat.attendanceRate < 0.5 ? "#ef4444" : "#22c55e" }}>
                {formatPercent(selectedSeat.attendanceRate)}
              </strong>
            </div>
            <div>
              <span>불참</span>
              <strong>{formatNumber(selectedSeat.absentCount)}건</strong>
            </div>
            <div>
              <span>반대</span>
              <strong>{formatNumber(selectedSeat.noCount)}건</strong>
            </div>
            <div>
              <span>기권</span>
              <strong>{formatNumber(selectedSeat.abstainCount)}건</strong>
            </div>
          </div>
          <div className="hemicycle-page__detail-bar">
            <div
              style={{
                width: `${(1 - selectedSeat.absentRate - (selectedSeat.noCount + selectedSeat.abstainCount) / Math.max(selectedSeat.totalRecordedVotes, 1)) * 100}%`,
                background: "#22c55e"
              }}
            />
            <div
              style={{
                width: `${(selectedSeat.noCount / Math.max(selectedSeat.totalRecordedVotes, 1)) * 100}%`,
                background: "#ef4444"
              }}
            />
            <div
              style={{
                width: `${(selectedSeat.abstainCount / Math.max(selectedSeat.totalRecordedVotes, 1)) * 100}%`,
                background: "#fb923c"
              }}
            />
            <div
              style={{
                width: `${selectedSeat.absentRate * 100}%`,
                background: "#64748b"
              }}
            />
          </div>
          <button
            type="button"
            className="hemicycle-page__detail-action"
            onClick={() => onSelectMember(selectedSeat.memberId)}
          >
            활동 캘린더 열기 →
          </button>
        </div>
      ) : null}
    </div>
  );
}
