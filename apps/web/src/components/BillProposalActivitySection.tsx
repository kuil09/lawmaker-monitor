import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { TableIcon } from "@phosphor-icons/react/dist/csr/Table";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";

import { MemberDetailLink } from "./MemberDetailLink.js";

import type {
  BillProposalActivityExport,
  BillProposalActivityItem
} from "@lawmaker-monitor/schemas";

function formatCount(value: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(value)}건`;
}

function formatRate(numerator: number, denominator: number): string {
  if (denominator <= 0) {
    return "—";
  }
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function getMedian(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  }
  return sorted[middle] ?? 0;
}

function BillActivityTooltip({
  active,
  payload,
  outcomeDataAvailable,
  onOpenMember
}: {
  active?: boolean;
  payload?: Array<{
    payload?: BillProposalActivityItem;
  }>;
  outcomeDataAvailable: boolean;
  onOpenMember: (memberId: string) => void;
}) {
  const item = payload?.[0]?.payload;
  if (!active || !item) {
    return null;
  }

  return (
    <div className="v2-chart-tooltip bill-activity-tooltip">
      <MemberDetailLink
        memberId={item.memberId}
        name={item.name}
        onNavigate={onOpenMember}
      />
      <span>{`${item.party} · ${item.district ?? "비례대표"}`}</span>
      <span>{`대표발의 ${formatCount(item.leadProposalCount)}`}</span>
      <span>{`공동발의 참여 ${formatCount(item.coSponsorProposalCount)}`}</span>
      {outcomeDataAvailable ? (
        <>
          <span>{`대표발의 결과 확인 ${formatCount(item.leadResultAvailableProposalCount)}`}</span>
          <span>{`대표발의 가결 ${formatCount(item.leadPassedProposalCount)} · 대안반영 ${formatCount(item.leadAlternativeReflectedProposalCount)}`}</span>
          <span>{`공개 결과 중 가결 ${formatRate(item.leadPassedProposalCount, item.leadResultAvailableProposalCount)}`}</span>
        </>
      ) : (
        <span>처리결과 집계 준비 중</span>
      )}
      <strong>{`전체 참여 ${formatCount(item.totalProposalCount)}`}</strong>
    </div>
  );
}

type BillProposalActivitySectionProps = {
  data: BillProposalActivityExport | null;
  loading: boolean;
  error: string | null;
  onOpenMember: (memberId: string) => void;
};

export function BillProposalActivitySection({
  data,
  loading,
  error,
  onOpenMember
}: BillProposalActivitySectionProps) {
  const [showTable, setShowTable] = useState(false);
  const rankedItems = useMemo(
    () =>
      [...(data?.items ?? [])].sort((left, right) => {
        if (right.totalProposalCount !== left.totalProposalCount) {
          return right.totalProposalCount - left.totalProposalCount;
        }
        if (right.leadProposalCount !== left.leadProposalCount) {
          return right.leadProposalCount - left.leadProposalCount;
        }
        return left.name.localeCompare(right.name, "ko-KR");
      }),
    [data]
  );
  const activeItems = rankedItems.filter((item) => item.totalProposalCount > 0);
  const chartItems = activeItems.slice(0, 12).reverse();
  const representativeProposalCount = rankedItems.reduce(
    (sum, item) => sum + item.leadProposalCount,
    0
  );
  const medianLeadCount = getMedian(
    activeItems.map((item) => item.leadProposalCount)
  );
  const coveragePercent =
    data && data.proposerLinkCount > 0
      ? (data.matchedProposerLinkCount / data.proposerLinkCount) * 100
      : 0;

  return (
    <section
      className="bill-activity-card"
      aria-labelledby="bill-activity-title"
    >
      <div className="bill-activity-card__header">
        <div>
          <p className="v2-card-kicker">입법 활동</p>
          <h2 id="bill-activity-title">의원별 법안 발의 참여 실적</h2>
          <p>
            공식 발의법률안의 의원 식별자를 역집계해 대표발의와 공동발의 참여를
            분리하고, 공개된 처리 결과를 함께 비교합니다.
          </p>
        </div>
        <button
          type="button"
          className="v2-button v2-button--quiet"
          aria-pressed={showTable}
          onClick={() => setShowTable((current) => !current)}
          disabled={!data}
        >
          <TableIcon size={18} />
          {showTable ? "차트 보기" : "전체 표 보기"}
        </button>
      </div>

      {error ? (
        <p className="bill-activity-card__state" role="alert">
          {error}
        </p>
      ) : loading && !data ? (
        <div className="bill-activity-card__state" role="status">
          <span className="v2-map-state__pulse" aria-hidden="true" />
          발의법률안 기록을 의원별로 집계하고 있습니다.
        </div>
      ) : !data ? (
        <p className="bill-activity-card__state">
          입법 활동 데이터가 다음 공식 기록 갱신에서 제공됩니다.
        </p>
      ) : (
        <>
          <dl className="bill-activity-card__stats">
            <div>
              <dt>집계 법안</dt>
              <dd>{formatCount(data.billCount)}</dd>
            </div>
            <div>
              <dt>처리결과 공개</dt>
              <dd>
                {data.outcomeDataAvailable
                  ? formatCount(data.resultAvailableBillCount)
                  : "준비 중"}
              </dd>
            </div>
            <div>
              <dt>원안·수정 가결</dt>
              <dd>
                {data.outcomeDataAvailable
                  ? formatCount(data.passedBillCount)
                  : "—"}
              </dd>
            </div>
            <div>
              <dt>대안반영폐기</dt>
              <dd>
                {data.outcomeDataAvailable
                  ? formatCount(data.alternativeReflectedBillCount)
                  : "—"}
              </dd>
            </div>
          </dl>

          {showTable ? (
            <div className="v2-data-table-wrap bill-activity-card__table">
              <table className="v2-data-table">
                <caption>의원별 법안 발의 참여 역집계</caption>
                <thead>
                  <tr>
                    <th scope="col">순위</th>
                    <th scope="col">의원</th>
                    <th scope="col">정당</th>
                    <th scope="col">대표발의</th>
                    <th scope="col">결과 확인</th>
                    <th scope="col">가결</th>
                    <th scope="col">대안반영</th>
                    <th scope="col">가결 비중</th>
                    <th scope="col">공동발의 참여</th>
                    <th scope="col">전체 참여</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedItems.map((item, index) => (
                    <tr key={item.memberId}>
                      <td>{index + 1}</td>
                      <th scope="row">
                        <MemberDetailLink
                          memberId={item.memberId}
                          name={item.name}
                          onNavigate={onOpenMember}
                        />
                      </th>
                      <td>{item.party}</td>
                      <td>{formatCount(item.leadProposalCount)}</td>
                      <td>
                        {data.outcomeDataAvailable
                          ? formatCount(item.leadResultAvailableProposalCount)
                          : "—"}
                      </td>
                      <td>
                        {data.outcomeDataAvailable
                          ? formatCount(item.leadPassedProposalCount)
                          : "—"}
                      </td>
                      <td>
                        {data.outcomeDataAvailable
                          ? formatCount(
                              item.leadAlternativeReflectedProposalCount
                            )
                          : "—"}
                      </td>
                      <td>
                        {data.outcomeDataAvailable
                          ? formatRate(
                              item.leadPassedProposalCount,
                              item.leadResultAvailableProposalCount
                            )
                          : "—"}
                      </td>
                      <td>{formatCount(item.coSponsorProposalCount)}</td>
                      <td>
                        <strong>{formatCount(item.totalProposalCount)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : chartItems.length > 0 ? (
            <div className="bill-activity-card__body">
              <div>
                <div className="bill-activity-card__legend">
                  <span>
                    <i className="is-lead" aria-hidden="true" />
                    대표발의
                  </span>
                  <span>
                    <i className="is-cosponsor" aria-hidden="true" />
                    공동발의 참여
                  </span>
                  <small>전체 참여 상위 12명</small>
                </div>
                <div
                  className="bill-activity-card__chart"
                  role="img"
                  aria-label="전체 법안 참여 상위 12명의 대표발의와 공동발의 참여 누적 막대그래프"
                >
                  <BarChart
                    responsive
                    style={{ width: "100%", height: "100%" }}
                    data={chartItems}
                    layout="vertical"
                    margin={{ top: 6, right: 18, bottom: 6, left: 6 }}
                    barCategoryGap="22%"
                  >
                    <CartesianGrid stroke="#e4e9ef" horizontal={false} />
                    <XAxis
                      type="number"
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "#687584" }}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={58}
                      tick={{ fontSize: 11, fill: "#526171" }}
                      tickLine={false}
                    />
                    <Tooltip
                      wrapperStyle={{ pointerEvents: "auto" }}
                      content={
                        <BillActivityTooltip
                          outcomeDataAvailable={data.outcomeDataAvailable}
                          onOpenMember={onOpenMember}
                        />
                      }
                    />
                    <Bar
                      dataKey="leadProposalCount"
                      name="대표발의"
                      stackId="participation"
                      fill="#2f66c7"
                    />
                    <Bar
                      dataKey="coSponsorProposalCount"
                      name="공동발의 참여"
                      stackId="participation"
                      fill="#2b8a73"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </div>
              </div>

              <aside className="bill-activity-card__method">
                <FileTextIcon size={26} weight="duotone" />
                <h3>발의량과 처리 결과는 다릅니다</h3>
                <p>
                  대표발의는 법안별 대표발의자, 공동발의 참여는 그 외 공개
                  발의자 연결을 각각 한 번만 셉니다. 가결은 원안가결과 수정가결,
                  대안반영은 대안반영폐기를 별도로 집계합니다.
                </p>
                <div>
                  <InfoIcon size={18} />
                  <p>
                    가결 비중은 처리결과가 공개된 대표발의안만 분모로 삼습니다.
                    미처리 법안은 실패로 계산하지 않습니다.
                  </p>
                </div>
                <small>
                  {`현재 의원 대표발의 ${formatCount(representativeProposalCount)} · 참여 의원 ${activeItems.length}명 · 대표발의 중앙값 ${formatCount(medianLeadCount)} · 식별자 연결률 ${coveragePercent.toFixed(1)}% · 미연결 식별자 ${data.unmatchedProposerCount}개`}
                </small>
              </aside>
            </div>
          ) : (
            <p className="bill-activity-card__state">
              현재 공개분에서 의원 식별자가 연결된 발의법률안이 없습니다.
            </p>
          )}
        </>
      )}
    </section>
  );
}
