import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { FunnelSimpleIcon } from "@phosphor-icons/react/dist/csr/FunnelSimple";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { useEffect, useMemo, useState } from "react";

import { VoteCard } from "./VoteCard.js";
import { formatDate, getKoreanDateKey } from "../lib/format.js";

import type { LatestVoteItem } from "@lawmaker-monitor/schemas";

type VoteCarouselProps = {
  items: LatestVoteItem[] | null;
  loading?: boolean;
  unavailable?: boolean;
};

type VoteFilter = "all" | "no" | "abstain" | "absent";

const voteFilters: Array<{ id: VoteFilter; label: string }> = [
  { id: "all", label: "전체" },
  { id: "no", label: "반대 있음" },
  { id: "abstain", label: "기권 있음" },
  { id: "absent", label: "불참 있음" }
];

const pageSize = 20;

export function VoteCarousel({
  items,
  loading = false,
  unavailable = false
}: VoteCarouselProps) {
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<VoteFilter>("all");
  const [visibleLimit, setVisibleLimit] = useState(pageSize);
  const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");

  const filterCounts = useMemo(() => {
    const sourceItems = items ?? [];

    return {
      all: sourceItems.length,
      no: sourceItems.filter((item) => item.counts.no > 0).length,
      abstain: sourceItems.filter((item) => item.counts.abstain > 0).length,
      absent: sourceItems.filter((item) => item.counts.absent > 0).length
    };
  }, [items]);

  const visibleItems = useMemo(() => {
    return [...(items ?? [])]
      .filter((item) => {
        if (activeFilter !== "all" && item.counts[activeFilter] === 0) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        return [
          item.billName,
          item.committeeName ?? "",
          item.rollCallId,
          item.meetingId
        ]
          .join(" ")
          .toLocaleLowerCase("ko-KR")
          .includes(normalizedQuery);
      })
      .sort(
        (left, right) =>
          new Date(right.voteDatetime).getTime() -
          new Date(left.voteDatetime).getTime()
      );
  }, [activeFilter, items, normalizedQuery]);

  useEffect(() => {
    setVisibleLimit(pageSize);
  }, [activeFilter, normalizedQuery]);

  const displayedItems = visibleItems.slice(0, visibleLimit);
  const remainingCount = Math.max(
    visibleItems.length - displayedItems.length,
    0
  );
  const nextPageCount = Math.min(pageSize, remainingCount);

  const groups = displayedItems.reduce<
    Array<{ dateKey: string; label: string; items: LatestVoteItem[] }>
  >((accumulator, item) => {
    const dateKey = getKoreanDateKey(item.voteDatetime);
    const lastGroup = accumulator[accumulator.length - 1];

    if (lastGroup?.dateKey === dateKey) {
      lastGroup.items.push(item);
      return accumulator;
    }

    accumulator.push({
      dateKey,
      label: formatDate(item.voteDatetime),
      items: [item]
    });
    return accumulator;
  }, []);

  if (loading) {
    return (
      <div className="v3-loading-state" role="status" aria-live="polite">
        <span className="v3-sr-only">최신 표결 기록을 불러오는 중입니다.</span>
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
      </div>
    );
  }

  if (unavailable) {
    return (
      <p className="v3-empty-state" role="status">
        최신 표결 데이터가 아직 준비되지 않았습니다.
      </p>
    );
  }

  if (!items) {
    return (
      <p className="v3-empty-state" role="status">
        최신 표결 데이터를 준비 중입니다.
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="v3-empty-state" role="status">
        공개된 최신 표결이 없습니다.
      </p>
    );
  }

  return (
    <div className="v3-vote-explorer">
      <div className="v3-vote-toolbar">
        <label className="v3-search-field">
          <span>안건 검색</span>
          <span className="v3-search-field__control">
            <MagnifyingGlassIcon size={18} weight="bold" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="법률안, 위원회 또는 표결 ID"
            />
          </span>
        </label>

        <div className="v3-filter-field">
          <span className="v3-filter-field__label">
            <FunnelSimpleIcon size={17} weight="bold" aria-hidden="true" />
            기록 필터
          </span>
          <div className="v3-filter-buttons" aria-label="표결 기록 필터">
            {voteFilters.map((filter) => (
              <button
                key={filter.id}
                type="button"
                aria-pressed={activeFilter === filter.id}
                onClick={() => setActiveFilter(filter.id)}
              >
                <span>{filter.label}</span>
                <strong>{filterCounts[filter.id]}</strong>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="v3-results-bar" role="status" aria-live="polite">
        <strong>{`${visibleItems.length}건`}</strong>
        <span>
          {`전체 ${items.length}건 중 현재 조건과 일치 · ${displayedItems.length}건 표시`}
        </span>
      </div>

      {groups.length === 0 ? (
        <p className="v3-empty-state">
          현재 검색어와 필터에 해당하는 표결 기록이 없습니다.
        </p>
      ) : null}

      <div className="v3-vote-timeline">
        {groups.map((group) => {
          return (
            <section key={group.dateKey} className="v3-vote-timeline__group">
              <header className="v3-vote-timeline__date">
                <CalendarBlankIcon size={19} weight="bold" aria-hidden="true" />
                <div>
                  <h3>
                    <time dateTime={group.dateKey}>{group.label}</time>
                  </h3>
                  <p>{`공개 기록 ${group.items.length}건`}</p>
                </div>
              </header>
              <div className="v3-vote-timeline__records">
                {group.items.map((item) => (
                  <VoteCard key={item.rollCallId} item={item} />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {remainingCount > 0 ? (
        <div className="v3-vote-pagination">
          <p aria-live="polite">
            {`${displayedItems.length}건을 확인했습니다. ${remainingCount}건이 더 있습니다.`}
          </p>
          <button
            type="button"
            onClick={() =>
              setVisibleLimit((currentLimit) => currentLimit + pageSize)
            }
          >
            {`다음 ${nextPageCount}건 보기`}
          </button>
        </div>
      ) : null}
    </div>
  );
}
