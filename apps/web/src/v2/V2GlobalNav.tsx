import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useEffect, useId, useState } from "react";

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
  label: string;
  href: string;
  target: "home" | "distribution" | "votes" | "trends";
  activeRoutes: V2GlobalNavRoute[];
};

const primaryNavigationItems: PrimaryNavigationItem[] = [
  {
    label: "개요",
    href: "#",
    target: "home",
    activeRoutes: ["home"]
  },
  {
    label: "의원",
    href: "#distribution",
    target: "distribution",
    activeRoutes: ["calendar", "distribution"]
  },
  {
    label: "표결",
    href: "#votes",
    target: "votes",
    activeRoutes: ["votes"]
  },
  {
    label: "분석",
    href: "#trends",
    target: "trends",
    activeRoutes: ["trends", "map"]
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
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    setIsMenuOpen(false);
  }, [route]);

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
            aria-label="국회 책임성 모니터 개요"
            aria-current={route === "home" ? "page" : undefined}
            onClick={(event) => handleNavigation(event, "home")}
          >
            <svg
              className="v2-global-nav__brand-mark"
              viewBox="0 0 64 64"
              width="32"
              height="32"
              aria-hidden="true"
              focusable="false"
            >
              <rect width="64" height="64" rx="16" fill="#171411" />
              <path
                d="M16 46V22.5L32 14l16 8.5V46H39.5V31.5h-15V46Z"
                fill="#f4f1eb"
              />
              <path
                d="M24 46V37h16v9"
                fill="none"
                stroke="#982d22"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
              />
            </svg>
            <span>국회 책임성 모니터</span>
          </a>

          {assemblyLabel ? (
            <span className="v2-global-nav__assembly">{assemblyLabel}</span>
          ) : null}

          <button
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
                  aria-current={
                    item.activeRoutes.includes(route) ? "page" : undefined
                  }
                  onClick={(event) => handleNavigation(event, item.target)}
                >
                  {item.label}
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
              placeholder="의원 이름 또는 정당 검색"
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
              <span>의원 보기</span>
            </button>
          </form>
        </div>
      </nav>
    </header>
  );
}
