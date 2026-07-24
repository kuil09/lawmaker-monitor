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
  onOpenMember
}: {
  active?: boolean;
  payload?: Array<{
    payload?: BillProposalActivityItem;
  }>;
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
            분리했습니다.
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
              <dt>대표발의 합계</dt>
              <dd>{formatCount(representativeProposalCount)}</dd>
            </div>
            <div>
              <dt>참여 의원</dt>
              <dd>{`${activeItems.length}명`}</dd>
            </div>
            <div>
              <dt>대표발의 중앙값</dt>
              <dd>{formatCount(medianLeadCount)}</dd>
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
                        <BillActivityTooltip onOpenMember={onOpenMember} />
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
                <h3>건수는 활동량입니다</h3>
                <p>
                  대표발의는 법안별 대표발의자, 공동발의 참여는 그 외 공개
                  발의자 연결을 각각 한 번만 셉니다.
                </p>
                <div>
                  <InfoIcon size={18} />
                  <p>
                    발의 건수만으로 법안의 품질, 통과 가능성 또는 정책 성과를
                    판단할 수 없습니다.
                  </p>
                </div>
                <small>
                  {`현재 의원 식별자 연결률 ${coveragePercent.toFixed(1)}% · 연결되지 않은 식별자 ${data.unmatchedProposerCount}개`}
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
