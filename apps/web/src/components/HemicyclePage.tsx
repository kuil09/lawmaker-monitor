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

const PARTY_ORDER = [
  "더불어민주당", "조국혁신당", "진보당", "사회민주당", "기본소득당",
  "무소속",
  "개혁신당", "국민의힘"
];
const PARTY_GAP_RAD = 0.035;

function buildSeatPositions(seats: SeatData[]): SeatPosition[] {
  const count = seats.length;
  if (count === 0) return [];

  // Group by party, sorted within each group by attendance (worst → outer)
  const partyGroups: Map<string, SeatData[]> = new Map();
  for (const party of PARTY_ORDER) {
    partyGroups.set(party, []);
  }
  for (const seat of seats) {
    const group = partyGroups.get(seat.party);
    if (group) {
      group.push(seat);
    } else {
      const misc = partyGroups.get("무소속")!;
      misc.push(seat);
    }
  }
  // Remove empty groups
  for (const [party, group] of partyGroups) {
    if (group.length === 0) partyGroups.delete(party);
    else group.sort((a, b) => b.attendanceRate - a.attendanceRate);
  }

  const parties = [...partyGroups.keys()];
  const partyTotals = parties.map((p) => partyGroups.get(p)!.length);
  const totalGapRad = PARTY_GAP_RAD * Math.max(parties.length - 1, 0);
  const edgePadding = 0.06;
  const availableArc = Math.PI - 2 * edgePadding - totalGapRad;

  // Each party gets proportional arc
  const partyArcs = partyTotals.map((n) => (n / count) * availableArc);

  // Determine row count
  let rowCount = 0;
  let testRadius = MIN_RADIUS;
  let testRemaining = count;
  while (testRemaining > 0) {
    const maxSeats = Math.floor((Math.PI * testRadius) / (SEAT_RADIUS * 2.6));
    testRemaining -= Math.min(maxSeats, testRemaining);
    testRadius += ROW_GAP;
    rowCount++;
  }

  // Build flat seat list per-party (each party fills rows proportionally)
  const positions: SeatPosition[] = [];

  for (let rowIdx = 0; rowIdx < rowCount; rowIdx++) {
    const radius = MIN_RADIUS + rowIdx * ROW_GAP;
    const maxRowCapacity = Math.floor((Math.PI * radius) / (SEAT_RADIUS * 2.6));
    let arcStart = edgePadding;

    for (let pi = 0; pi < parties.length; pi++) {
      const party = parties[pi]!;
      const group = partyGroups.get(party)!;
      const partyArc = partyArcs[pi]!;

      // How many seats this party gets in this row (proportional to arc)
      const partyRowCapacity = Math.max(1, Math.round((partyArc / availableArc) * maxRowCapacity));
      const seatsInRow = Math.min(partyRowCapacity, group.length);

      if (seatsInRow > 0) {
        const taken = group.splice(0, seatsInRow);
        for (let i = 0; i < taken.length; i++) {
          const t = taken.length > 1 ? i / (taken.length - 1) : 0.5;
          const angle = arcStart + t * partyArc;
          positions.push({
            x: CENTER_X - radius * Math.cos(angle),
            y: CENTER_Y - radius * Math.sin(angle),
            seat: taken[i]!
          });
        }
      }

      arcStart += partyArc + (pi < parties.length - 1 ? PARTY_GAP_RAD : 0);
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
