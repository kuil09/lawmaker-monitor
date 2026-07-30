import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useEffect, useId, useRef, useState } from "react";

import {
  MemberSearchField,
  type MemberSearchOption
} from "../components/MemberSearchField.js";

export type V2GlobalNavRoute =
  | "home"
  | "calendar"
  | "distribution"
  | "votes"
  | "trends"
  | "map";

type V2NavigationRoute = Exclude<V2GlobalNavRoute, "home">;

export type V2GlobalNavProps = {
  route: V2GlobalNavRoute;
  assemblyLabel?: string;
  memberName?: string | null;
  searchOptions: MemberSearchOption[];
  selectedSearchMemberId: string | null;
  onHome: () => void;
  onNavigate: (route: V2NavigationRoute) => void;
  onSelectSearchMemberId: (memberId: string | null) => void;
  onSubmitSearch: () => void;
};

type PrimaryNavigationItem = {
  index: string;
  label: string;
  accessibleLabel: string;
  href: string;
  target: "home" | "distribution" | "map" | "votes" | "trends";
  activeRoutes: V2GlobalNavRoute[];
};

const primaryNavigationItems: PrimaryNavigationItem[] = [
  {
    index: "01",
    label: "국회 출석부",
    accessibleLabel: "오늘의 변화",
    href: "#",
    target: "home",
    activeRoutes: ["home"]
  },
  {
    index: "02",
    label: "의원 대장",
    accessibleLabel: "의원 찾기",
    href: "#distribution",
    target: "distribution",
    activeRoutes: ["calendar", "distribution"]
  },
  {
    index: "03",
    label: "지역 감시",
    accessibleLabel: "지역 탐색",
    href: "#map",
    target: "map",
    activeRoutes: ["map"]
  },
  {
    index: "04",
    label: "쟁점·표결",
    accessibleLabel: "표결 기록",
    href: "#votes",
    target: "votes",
    activeRoutes: ["votes"]
  },
  {
    index: "05",
    label: "변화 전후",
    accessibleLabel: "추세",
    href: "#trends",
    target: "trends",
    activeRoutes: ["trends"]
  }
];

export function V2GlobalNav({
  route,
  assemblyLabel,
  memberName,
  searchOptions,
  selectedSearchMemberId,
  onHome,
  onNavigate,
  onSelectSearchMemberId,
  onSubmitSearch
}: V2GlobalNavProps) {
  const menuId = useId();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [route]);

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      setIsMenuOpen(false);
      menuButtonRef.current?.focus();
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isMenuOpen]);

  function handleNavigation(
    event: React.MouseEvent<HTMLAnchorElement>,
    target: PrimaryNavigationItem["target"]
  ) {
    event.preventDefault();
    setIsMenuOpen(false);

    if (target === "home") {
      onHome();
      return;
    }

    onNavigate(target);
  }

  function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedSearchMemberId) {
      return;
    }

    setIsMenuOpen(false);
    onSubmitSearch();
  }

  return (
    <header className="v2-global-nav">
      <a className="v2-global-nav__skip-link" href="#v2-main-content">
        본문으로 건너뛰기
      </a>
      <nav className="v2-global-nav__inner" aria-label="사이트 내비게이션">
        <div className="v2-global-nav__masthead">
          <a
            className="v2-global-nav__brand"
            href="#"
            aria-label="국회 출석부 홈"
            onClick={(event) => handleNavigation(event, "home")}
          >
            <span className="v2-global-nav__brand-lockup" aria-hidden="true">
              <span className="v2-global-nav__brand-kicker">
                국회 공개 기록
              </span>
              <strong>국회 출석부</strong>
            </span>
          </a>

          <button
            ref={menuButtonRef}
            className="v2-global-nav__menu-button"
            type="button"
            aria-expanded={isMenuOpen}
            aria-controls={menuId}
            aria-label={isMenuOpen ? "메뉴 닫기" : "메뉴 열기"}
            onClick={() => setIsMenuOpen((isOpen) => !isOpen)}
          >
            {isMenuOpen ? (
              <XIcon aria-hidden="true" size={22} weight="bold" />
            ) : (
              <ListIcon aria-hidden="true" size={22} weight="bold" />
            )}
          </button>
        </div>

        <div
          id={menuId}
          className="v2-global-nav__menu"
          data-open={isMenuOpen ? "true" : "false"}
        >
          <ul className="v2-global-nav__primary">
            {primaryNavigationItems.map((item) => (
              <li key={item.target}>
                <a
                  className="v2-global-nav__link"
                  href={item.href}
                  aria-label={item.accessibleLabel}
                  aria-current={
                    item.activeRoutes.includes(route) ? "page" : undefined
                  }
                  onClick={(event) => handleNavigation(event, item.target)}
                >
                  <span
                    className="v2-global-nav__link-index"
                    aria-hidden="true"
                  >
                    {item.index}
                  </span>
                  <span className="v2-global-nav__link-copy" aria-hidden="true">
                    <strong>{item.label}</strong>
                    <small>{item.accessibleLabel}</small>
                  </span>
                </a>
              </li>
            ))}
          </ul>

          <form
            className="v2-global-nav__search"
            role="search"
            aria-label="의원 검색"
            onSubmit={handleSearchSubmit}
          >
            <MemberSearchField
              className="v2-global-nav__search-field"
              label="의원 검색"
              options={searchOptions}
              selectedId={selectedSearchMemberId}
              onSelect={onSelectSearchMemberId}
              placeholder="의원·정당·지역구 검색"
              disabled={searchOptions.length === 0}
            />
            <button
              className="v2-global-nav__search-submit"
              type="submit"
              disabled={!selectedSearchMemberId}
              aria-label={
                memberName
                  ? `${memberName} 의원 활동 보기`
                  : "선택한 의원 활동 보기"
              }
            >
              <MagnifyingGlassIcon aria-hidden="true" size={19} weight="bold" />
              <span>기록 열기</span>
            </button>
          </form>

          {assemblyLabel ? (
            <span className="v2-global-nav__assembly">
              <span>수집 기준</span>
              <strong>{assemblyLabel}</strong>
            </span>
          ) : null}
        </div>
      </nav>
    </header>
  );
}
