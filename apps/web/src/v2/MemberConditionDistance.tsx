import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis
} from "recharts";

import {
  buildMemberDistances,
  groupMemberDistances
} from "../lib/member-distance.js";

import type { MemberDistance } from "../lib/member-distance.js";
import type { AnalysisMember } from "@lawmaker-monitor/schemas";

type DistanceGroup = ReturnType<typeof groupMemberDistances>[number];
function conditions(row: MemberDistance) {
  return `${row.sharedCommittees.length ? `공통 위원회 ${row.sharedCommittees.length}곳` : "공통 위원회 없음"} · ${row.sameReelection ? "같은 선수" : "다른 선수"} · ${row.sameElectionType ? "같은 선출 방식" : "다른 선출 방식"}`;
}

export function MemberConditionDistance({
  member,
  members,
  onChoose
}: {
  member: AnalysisMember;
  members: AnalysisMember[];
  onChoose: (id: string) => void;
}) {
  const rows = useMemo(
    () => buildMemberDistances(member, members),
    [member, members]
  );
  const groups = useMemo(() => groupMemberDistances(rows), [rows]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const active = groups.find((group) => group.key === selectedKey) ?? groups[0];
  const nearest = rows.filter((row) => row.distance === rows[0]?.distance);
  const farthest = rows.filter((row) => row.distance === rows.at(-1)?.distance);
  const referenceCommittees = new Set(member.committees).size;
  const maxShared = Math.max(
    1,
    referenceCommittees,
    ...groups.map((group) => group.shared)
  );
  const excluded =
    members.filter(
      (other) =>
        other.memberId !== member.memberId &&
        other.assemblyNo === member.assemblyNo
    ).length - rows.length;
  const [showAll, setShowAll] = useState(false);

  function selectGroup(group: DistanceGroup) {
    setSelectedKey(group.key);
    setShowAll(false);
  }
  function choices(label: string, candidates: MemberDistance[]) {
    return (
      <div className="condition-extreme">
        <div className="condition-extreme-heading">
          <strong>{label}</strong>
          <span>
            거리 {candidates[0]?.distance.toFixed(1) ?? "—"} · 동률{" "}
            {candidates.length}명
          </span>
        </div>
        <div className="condition-member-choices">
          {candidates.slice(0, 3).map((row) => (
            <button
              key={row.member.memberId}
              type="button"
              onClick={() =>
                selectGroup(groups.find((group) => group.rows.includes(row))!)
              }
            >
              <strong>{row.member.name}</strong>
              <span>
                {row.member.party} · {row.member.reelectionLabel}
              </span>
              <small>{conditions(row)}</small>
            </button>
          ))}
        </div>
        {candidates.length > 3 ? (
          <p className="analysis-note">
            동률 중 공식 ID순 3명 표시 · 전체 의원은 아래 거리 묶음에서 확인
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="condition-distance">
      <div className="condition-distance-intro">
        <div>
          <p className="condition-kicker">현재 조건으로 비교</p>
          <h4>{member.name} 의원과 얼마나 다른 조건일까요?</h4>
        </div>
        <p>
          <strong>{rows.length}명</strong> 비교 · 자료 부족 {excluded}명 제외
        </p>
      </div>
      <p className="analysis-note">
        위원회 구성·선수·선출 방식의 차이를 같은 비중으로 합산합니다. 0은 세
        조건이 같고, 100은 모두 다릅니다. 정당·정치 성향·활동 성과의 거리가
        아닙니다.
      </p>
      {rows.length ? (
        <>
          <div
            className="condition-distance-plot"
            role="img"
            aria-label={`${member.name} 기준 조건 거리 분포. 가로축은 조건 거리 0부터 100, 세로축은 공통 위원회 수, 원의 크기는 같은 위치의 의원 수입니다. 아래 버튼으로도 모든 분포를 선택할 수 있습니다.`}
          >
            <ResponsiveContainer
              width="100%"
              height="100%"
              minWidth={0}
              initialDimension={{ width: 800, height: 285 }}
            >
              <ScatterChart
                margin={{ top: 24, right: 32, bottom: 28, left: 5 }}
                accessibilityLayer={false}
              >
                <CartesianGrid
                  stroke="var(--border)"
                  strokeDasharray="3 4"
                  vertical={false}
                />
                <XAxis
                  type="number"
                  dataKey="distance"
                  domain={[-5, 105]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border-strong)" }}
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                  label={{
                    value: "같은 조건  ←  조건 거리  →  다른 조건",
                    position: "bottom",
                    fill: "var(--text-muted)",
                    fontSize: 11
                  }}
                />
                <YAxis
                  type="number"
                  dataKey="shared"
                  domain={[-0.5, maxShared + 0.5]}
                  ticks={Array.from({ length: maxShared + 1 }, (_, i) => i)}
                  tickLine={false}
                  axisLine={false}
                  width={75}
                  tickFormatter={(value: number) => `공통 ${value}곳`}
                  tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                />
                <ZAxis type="number" dataKey="count" range={[90, 700]} />
                <Tooltip
                  cursor={false}
                  content={({ payload }) => {
                    const group = payload?.[0]?.payload as
                      | DistanceGroup
                      | undefined;
                    if (group?.key === "reference")
                      return (
                        <div className="condition-tooltip">
                          <strong>{member.name} · 기준 의원</strong>
                          <p>거리 0 · 현재 위원회 {referenceCommittees}곳</p>
                        </div>
                      );
                    return group ? (
                      <div className="condition-tooltip">
                        <strong>
                          조건 거리 {group.distance.toFixed(1)} · {group.count}
                          명
                        </strong>
                        <p>공통 위원회 {group.shared}곳</p>
                        <p>
                          {group.rows
                            .slice(0, 4)
                            .map((row) => row.member.name)
                            .join(" · ")}
                          {group.count > 4 ? " 외" : ""}
                        </p>
                        <small>눌러서 의원과 비교 근거 확인</small>
                      </div>
                    ) : null;
                  }}
                />
                <Scatter
                  isAnimationActive={false}
                  name="기준 의원"
                  data={[
                    {
                      key: "reference",
                      distance: 0,
                      shared: referenceCommittees,
                      count: 1,
                      rows: []
                    }
                  ]}
                  shape="diamond"
                  fill="var(--text)"
                />
                <Scatter
                  isAnimationActive={false}
                  name="조건이 가까운 의원"
                  data={groups.filter(
                    (group) => group.distance === rows[0]!.distance
                  )}
                  fill="var(--accent)"
                  onClick={(point) =>
                    selectGroup(point.payload as DistanceGroup)
                  }
                />
                <Scatter
                  isAnimationActive={false}
                  name="조건이 다른 의원"
                  data={groups.filter(
                    (group) => group.distance !== rows[0]!.distance
                  )}
                  fill="var(--text-muted)"
                  onClick={(point) =>
                    selectGroup(point.payload as DistanceGroup)
                  }
                />
                <Scatter
                  isAnimationActive={false}
                  name="선택한 거리"
                  data={active ? [active] : []}
                  fill="var(--accent-highlight)"
                  stroke="var(--text)"
                  strokeWidth={2}
                  onClick={(point) =>
                    selectGroup(point.payload as DistanceGroup)
                  }
                />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <p className="condition-chart-key">
            마름모 = 기준 의원 · 원 크기 = 해당 위치의 의원 수 · 가로 위치 =
            조건 거리 · 세로 위치 = 공통 위원회 수
          </p>
          <div className="condition-extremes">
            {choices("가장 가까운 조건", nearest)}
            {choices("가장 먼 조건", farthest)}
          </div>
          <div className="condition-group-picker" aria-label="조건 거리 선택">
            {groups.map((group) => (
              <button
                type="button"
                key={group.key}
                aria-pressed={active?.key === group.key}
                onClick={() => selectGroup(group)}
              >
                거리 {group.distance.toFixed(1)} · 공통 {group.shared}곳{" "}
                <strong>{group.count}명</strong>
              </button>
            ))}
          </div>
          {active ? (
            <div className="condition-selection">
              <div className="condition-selection-heading" aria-live="polite">
                <strong>선택한 조건 거리 {active.distance.toFixed(1)}</strong>
                <span>
                  공통 위원회 {active.shared}곳 · {active.count}명
                  {active.count > 6 && !showAll ? " 중 6명 표시" : ""}
                </span>
              </div>
              <ul>
                {(showAll ? active.rows : active.rows.slice(0, 6)).map(
                  (row) => (
                    <li key={row.member.memberId}>
                      <div>
                        <strong>{row.member.name}</strong>
                        <span>
                          {row.member.party} · {row.member.reelectionLabel} ·{" "}
                          {row.member.proportionalFlag ? "비례대표" : "지역구"}
                        </span>
                        <small>
                          {row.sharedCommittees.join(" · ") ||
                            "공통 위원회 없음"}
                        </small>
                      </div>
                      <button
                        type="button"
                        onClick={() => onChoose(row.member.memberId)}
                        aria-label={`${row.member.name} 기준으로 분석`}
                      >
                        이 의원 기준으로 보기
                      </button>
                    </li>
                  )
                )}
              </ul>
              {active.count > 6 ? (
                <button type="button" onClick={() => setShowAll(!showAll)}>
                  {showAll ? "6명만 보기" : `${active.count}명 모두 보기`}
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ) : (
        <p className="condition-empty">
          세 조건이 모두 확인된 비교 대상이 없습니다. 자료 부족을 다른 조건으로
          계산하지 않습니다.
        </p>
      )}
      <details className="condition-method">
        <summary>거리 계산과 동률 표시 기준</summary>
        <p>
          위원회 차이 = 1 − 공통 위원회 수 ÷ 두 의원 위원회 합집합 수. 선수·선출
          방식은 같으면 0, 다르면 1입니다. 세 값을 평균해 100을 곱합니다. 세
          조건이 모두 확인된 같은 대수의 의원만 비교합니다. 동률은 공식 의원
          ID순으로 표시하며 순위 차이를 뜻하지 않습니다. 현재 소속 조건의
          비교이며 선택한 활동 기간 필터는 거리를 바꾸지 않습니다.
        </p>
      </details>
    </div>
  );
}
