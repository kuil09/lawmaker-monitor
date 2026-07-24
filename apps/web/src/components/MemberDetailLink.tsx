import { buildCalendarHref } from "../lib/calendar-route.js";

import type { MouseEvent, ReactNode } from "react";

type MemberDetailLinkProps = {
  memberId: string;
  name: string;
  children?: ReactNode;
  className?: string;
  onNavigate?: (memberId: string) => void;
};

export function MemberDetailLink({
  memberId,
  name,
  children,
  className,
  onNavigate
}: MemberDetailLinkProps) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (!onNavigate) {
      return;
    }

    event.preventDefault();
    onNavigate(memberId);
  }

  return (
    <a
      className={
        className ? `member-detail-link ${className}` : "member-detail-link"
      }
      href={buildCalendarHref({ memberId })}
      aria-label={`${name} 의원 상세 보기`}
      onClick={handleClick}
    >
      {children ?? name}
    </a>
  );
}
