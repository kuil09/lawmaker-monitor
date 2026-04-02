import type React from "react";

type GlobalNavRoute = "home" | "calendar" | "distribution";

type GlobalNavProps = {
  route: GlobalNavRoute;
  assemblyLabel?: string;
  memberName?: string | null;
  onHome?: () => void;
};

export function GlobalNav({ route, assemblyLabel, memberName, onHome }: GlobalNavProps) {
  function handleHomeClick(event: React.MouseEvent) {
    event.preventDefault();
    onHome?.();
  }

  const currentPageLabel =
    route === "distribution"
      ? "전체 분포"
      : route === "calendar"
        ? (memberName ?? "의원 활동")
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

        {assemblyLabel ? (
          <span className="global-nav__assembly">{assemblyLabel}</span>
        ) : null}
      </div>
    </nav>
  );
}
