import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { ScalesIcon } from "@phosphor-icons/react/dist/csr/Scales";

import { formatDate } from "../lib/format.js";
import "../styles/issue-comparison.css";

import type { LatestVoteItem } from "@lawmaker-monitor/schemas";

type IssueComparisonBoardProps = {
  items: LatestVoteItem[];
};

function getRecordedVoteCount(item: LatestVoteItem): number {
  return (
    item.counts.yes + item.counts.no + item.counts.abstain + item.counts.absent
  );
}

function getDissentRate(item: LatestVoteItem): number {
  const total = getRecordedVoteCount(item);
  return total > 0
    ? (item.counts.no + item.counts.abstain + item.counts.absent) / total
    : 0;
}

export function IssueComparisonBoard({ items }: IssueComparisonBoardProps) {
  const comparisonItems = [...items]
    .sort(
      (left, right) =>
        new Date(right.voteDatetime).getTime() -
        new Date(left.voteDatetime).getTime()
    )
    .slice(0, 3);

  if (comparisonItems.length === 0) {
    return null;
  }

  return (
    <section
      className="issue-comparison"
      aria-labelledby="issue-comparison-title"
    >
      <header className="issue-comparison__head">
        <div>
          <h2 id="issue-comparison-title">쟁점별 표결 대조</h2>
        </div>
        <p>
          최근 공개 표결을 같은 구조로 놓고 찬성, 반대, 기권, 불참과 원문을
          비교합니다.
        </p>
      </header>
      <div className="issue-comparison__grid">
        {comparisonItems.map((item, index) => {
          const total = getRecordedVoteCount(item);
          const dissentRate = getDissentRate(item);
          return (
            <article key={item.rollCallId}>
              <header>
                <span>{`ISSUE ${String(index + 1).padStart(2, "0")}`}</span>
                <time dateTime={item.voteDatetime}>
                  {formatDate(item.voteDatetime)}
                </time>
              </header>
              <div className="issue-comparison__title">
                <ScalesIcon size={22} weight="duotone" aria-hidden="true" />
                <div>
                  <h3>{item.billName}</h3>
                  <p>{item.committeeName ?? "본회의"}</p>
                </div>
              </div>
              <dl>
                <div className="is-yes">
                  <dt>찬성</dt>
                  <dd>{item.counts.yes}</dd>
                </div>
                <div className="is-no">
                  <dt>반대</dt>
                  <dd>{item.counts.no}</dd>
                </div>
                <div className="is-abstain">
                  <dt>기권</dt>
                  <dd>{item.counts.abstain}</dd>
                </div>
                <div className="is-absent">
                  <dt>불참</dt>
                  <dd>{item.counts.absent}</dd>
                </div>
              </dl>
              <div
                className="issue-comparison__bar"
                role="img"
                aria-label={`전체 ${total}명 중 찬성 ${item.counts.yes}명, 반대 ${item.counts.no}명, 기권 ${item.counts.abstain}명, 불참 ${item.counts.absent}명`}
              >
                {(
                  [
                    ["yes", item.counts.yes],
                    ["no", item.counts.no],
                    ["abstain", item.counts.abstain],
                    ["absent", item.counts.absent]
                  ] as const
                ).map(([key, value]) => (
                  <span
                    key={key}
                    className={`is-${key}`}
                    style={{
                      width: `${total > 0 ? (value / total) * 100 : 0}%`
                    }}
                  />
                ))}
              </div>
              <footer>
                <span>
                  <strong>{`${(dissentRate * 100).toFixed(1)}%`}</strong>
                  반대·기권·불참
                </span>
                <a
                  href={item.officialSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  공식 원문
                  <ArrowSquareOutIcon size={15} aria-hidden="true" />
                </a>
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}
