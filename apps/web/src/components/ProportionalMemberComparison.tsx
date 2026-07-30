import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";

import { MemberDetailLink } from "./MemberDetailLink.js";
import "../styles/proportional-member-comparison.css";

export type ProportionalComparisonItem = {
  memberId: string;
  name: string;
  party: string;
  photoUrl?: string | null;
  primaryLabel: string;
  primaryValue: string;
  secondaryLabel: string;
  secondaryValue: string;
  basisValue: string;
  sortValue: number;
};

type ProportionalMemberComparisonProps = {
  headingId: string;
  kicker: string;
  title: string;
  description: string;
  comparisonNote: string;
  items: ProportionalComparisonItem[];
  onOpenMember: (memberId: string) => void;
};

function ProportionalPortrait({
  item
}: {
  item: ProportionalComparisonItem;
}) {
  if (item.photoUrl) {
    return (
      <img
        className="proportional-comparison__portrait"
        src={item.photoUrl}
        alt=""
      />
    );
  }

  return (
    <span
      className="proportional-comparison__portrait proportional-comparison__portrait--fallback"
      aria-hidden="true"
    >
      {item.name.slice(0, 1)}
    </span>
  );
}

export function ProportionalMemberComparison({
  headingId,
  kicker,
  title,
  description,
  comparisonNote,
  items,
  onOpenMember
}: ProportionalMemberComparisonProps) {
  const sortedItems = [...items].sort(
    (left, right) =>
      right.sortValue - left.sortValue ||
      left.name.localeCompare(right.name, "ko-KR")
  );
  const partyCount = new Set(items.map((item) => item.party)).size;

  return (
    <section
      className="proportional-comparison"
      aria-labelledby={headingId}
    >
      <header className="proportional-comparison__header">
        <div>
          <p>{kicker}</p>
          <h2 id={headingId}>{title}</h2>
          <span>{description}</span>
        </div>
        <dl>
          <div>
            <dt>비교 의원</dt>
            <dd>{items.length}명</dd>
          </div>
          <div>
            <dt>소속 정당</dt>
            <dd>{partyCount}개</dd>
          </div>
        </dl>
      </header>

      {sortedItems.length > 0 ? (
        <>
          <ol className="proportional-comparison__list">
            {sortedItems.map((item, index) => (
              <li key={item.memberId}>
                <span className="proportional-comparison__rank">
                  <b>{index + 1}</b>
                  <small>{`/ ${sortedItems.length}`}</small>
                </span>
                <ProportionalPortrait item={item} />
                <div className="proportional-comparison__identity">
                  <MemberDetailLink
                    memberId={item.memberId}
                    name={item.name}
                    onNavigate={onOpenMember}
                  >
                    <strong>{item.name}</strong>
                    <ArrowRightIcon size={15} aria-hidden="true" />
                  </MemberDetailLink>
                  <span>{`${item.party} · 비례대표`}</span>
                  <small>{item.basisValue}</small>
                </div>
                <dl className="proportional-comparison__metrics">
                  <div>
                    <dt>{item.primaryLabel}</dt>
                    <dd>{item.primaryValue}</dd>
                  </div>
                  <div>
                    <dt>{item.secondaryLabel}</dt>
                    <dd>{item.secondaryValue}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ol>
          <p className="proportional-comparison__note">{comparisonNote}</p>
        </>
      ) : (
        <div className="proportional-comparison__empty" role="status">
          <UsersThreeIcon size={24} aria-hidden="true" />
          <strong>현재 지표로 비교할 비례대표 자료가 없습니다.</strong>
        </div>
      )}
    </section>
  );
}
