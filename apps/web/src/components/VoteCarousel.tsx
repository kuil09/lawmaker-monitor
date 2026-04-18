import { useEffect, useState } from "react";

import { VoteCard } from "./VoteCard.js";
import { formatDate, getKoreanDateKey } from "../lib/format.js";

import type { LatestVoteItem } from "@lawmaker-monitor/schemas";

type VoteCarouselProps = {
  items: LatestVoteItem[] | null;
  loading?: boolean;
  unavailable?: boolean;
};

function getCardsPerPage(): number {
  if (typeof window === "undefined") {
    return 2;
  }

  if (typeof window.matchMedia === "function") {
    return window.matchMedia("(max-width: 760px)").matches ? 1 : 2;
  }

  return window.innerWidth <= 760 ? 1 : 2;
}

export function VoteCarousel({
  items,
  loading = false,
  unavailable = false
}: VoteCarouselProps) {
  const [cardsPerPage, setCardsPerPage] = useState(getCardsPerPage);
  const [pagesByDate, setPagesByDate] = useState<Record<string, number>>({});
  const groups = (items ?? []).reduce<
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

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(max-width: 760px)");
    const updateLayout = () => {
      setCardsPerPage(mediaQuery.matches ? 1 : 2);
    };

    updateLayout();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateLayout);
      return () => {
        mediaQuery.removeEventListener("change", updateLayout);
      };
    }

    mediaQuery.addListener(updateLayout);
    return () => {
      mediaQuery.removeListener(updateLayout);
    };
  }, []);

  useEffect(() => {
    setPagesByDate({});
  }, [cardsPerPage, items?.length]);

  if (loading) {
    return (
      <div className="vote-carousel__placeholder" aria-hidden="true">
        <span />
        <span />
      </div>
    );
  }

  if (unavailable) {
    return (
      <p className="vote-carousel__empty">
        최신 표결 데이터가 아직 준비되지 않았습니다.
      </p>
    );
  }

  if (!items) {
    return (
      <p className="vote-carousel__empty">최신 표결 데이터를 준비 중입니다.</p>
    );
  }

  if (items.length === 0) {
    return <p className="vote-carousel__empty">공개된 최신 표결이 없습니다.</p>;
  }

  return (
    <div className="vote-carousel">
      {groups.map((group) => {
        const pageCount = Math.max(
          1,
          Math.ceil(group.items.length / cardsPerPage)
        );
        const currentPage = Math.min(
          pagesByDate[group.dateKey] ?? 0,
          pageCount - 1
        );
        const visibleItems = group.items.slice(
          currentPage * cardsPerPage,
          currentPage * cardsPerPage + cardsPerPage
        );

        return (
          <section key={group.dateKey} className="vote-carousel__group">
            <header className="vote-carousel__group-header">
              <div className="vote-carousel__group-heading">
                <h3 className="vote-carousel__group-title">{group.label}</h3>
                <p className="vote-carousel__group-count">{`${group.items.length}건`}</p>
              </div>
              {pageCount > 1 ? (
                <div className="vote-carousel__controls">
                  <span className="vote-carousel__status" aria-live="polite">
                    {`${currentPage + 1} / ${pageCount}`}
                  </span>
                  <div className="vote-carousel__buttons">
                    <button
                      type="button"
                      className="vote-carousel__button"
                      aria-label={`${group.label} 이전 페이지`}
                      onClick={() =>
                        setPagesByDate((previous) => ({
                          ...previous,
                          [group.dateKey]: Math.max(0, currentPage - 1)
                        }))
                      }
                      disabled={currentPage === 0}
                    >
                      이전
                    </button>
                    <button
                      type="button"
                      className="vote-carousel__button"
                      aria-label={`${group.label} 다음 페이지`}
                      onClick={() =>
                        setPagesByDate((previous) => ({
                          ...previous,
                          [group.dateKey]: Math.min(
                            pageCount - 1,
                            currentPage + 1
                          )
                        }))
                      }
                      disabled={currentPage === pageCount - 1}
                    >
                      다음
                    </button>
                  </div>
                </div>
              ) : null}
            </header>
            <div
              className={
                cardsPerPage === 1
                  ? "vote-carousel__slides vote-carousel__slides--single"
                  : "vote-carousel__slides"
              }
            >
              {visibleItems.map((item) => (
                <VoteCard key={item.rollCallId} item={item} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
