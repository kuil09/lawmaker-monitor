import type React from "react";

type GlobalNavRoute = "home" | "calendar" | "distribution" | "votes" | "trends" | "lab";

type GlobalNavProps = {
  route: GlobalNavRoute;
  assemblyLabel?: string;
  memberName?: string | null;
  onHome?: () => void;
  onNavigate?: (route: "votes" | "trends" | "lab") => void;
};

export function GlobalNav({ route, assemblyLabel, memberName, onHome, onNavigate }: GlobalNavProps) {
  function handleHomeClick(event: React.MouseEvent) {
    event.preventDefault();
    onHome?.();
  }

  function handleNavClick(event: React.MouseEvent, target: "votes" | "trends" | "lab") {
    event.preventDefault();
    onNavigate?.(target);
  }

  const currentPageLabel =
    route === "distribution"
      ? "전체 분포"
      : route === "calendar"
        ? (memberName ?? "의원 활동")
        : route === "votes"
          ? "최근 표결"
          : route === "trends"
            ? "출석 추이"
            : route === "lab"
              ? "실험실"
              : null;

  return (
    <nav className="global-nav" aria-label="사이트 내비게이션">
      <div className="global-nav__inner">
        <a
          href="#"
          className="global-nav__brand"
          onClick={handleHomeClick}
          aria-current={route === "home" ? "page" : undefined}
        >
          국회 책임성 모니터
        </a>

        {route !== "home" && currentPageLabel ? (
          <>
            <span className="global-nav__sep" aria-hidden="true">›</span>
            <span className="global-nav__crumb-current" aria-current="page">
              {currentPageLabel}
            </span>
          </>
        ) : null}

        {route === "home" ? (
          <div className="global-nav__links">
            <a
              href="#votes"
              className="global-nav__link"
              onClick={(e) => handleNavClick(e, "votes")}
            >
              최근 표결
            </a>
            <a
              href="#trends"
              className="global-nav__link"
              onClick={(e) => handleNavClick(e, "trends")}
            >
              출석 추이
            </a>
            <a
              href="#lab"
              className="global-nav__link"
              onClick={(e) => handleNavClick(e, "lab")}
            >
              실험실
            </a>
          </div>
        ) : null}

        {assemblyLabel ? (
          <span className="global-nav__assembly">{assemblyLabel}</span>
        ) : null}
      </div>
    </nav>
  );
}
