import { useId } from "react";

import "../styles/member-share.css";

import type { MemberSponsorshipAccount } from "@lawmaker-monitor/schemas";

type MemberSponsorshipAccountProps = {
  account?: MemberSponsorshipAccount | null;
  memberName?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
};

const politicalDonationCenterUrl =
  "https://www.give.go.kr/portal/supporter/supporterSearch/list.do?menuNo=200025";

function toOfficialSponsorshipUrl(value?: string): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.give.go.kr"
      ? value
      : null;
  } catch {
    return null;
  }
}

export function MemberSponsorshipAccount({
  account,
  memberName,
  loading = false,
  error = null,
  onRetry
}: MemberSponsorshipAccountProps) {
  const titleId = useId();
  const isCurrentRecord = account?.status !== "superseded";
  const sourceUrl = isCurrentRecord
    ? toOfficialSponsorshipUrl(account?.sourceUrl)
    : null;
  const donationUrl = isCurrentRecord
    ? toOfficialSponsorshipUrl(account?.donationUrl)
    : null;
  const hasOfficialRouteRecord = Boolean(sourceUrl || donationUrl);

  return (
    <section className="member-sponsorship-account" aria-labelledby={titleId}>
      <header className="member-sponsorship-account__header">
        <div>
          <p className="section-label">공식 후원 링크</p>
          <h3 id={titleId}>
            {memberName
              ? `${memberName} 의원 공식 후원 경로`
              : "국회의원 공식 후원 경로"}
          </h3>
        </div>
        <span
          className={`member-sponsorship-account__status member-sponsorship-account__status--${
            hasOfficialRouteRecord ? "verified" : "unavailable"
          }`}
        >
          {loading
            ? "확인 중"
            : error
              ? "불러오기 실패"
              : donationUrl
                ? "공식 링크 확인"
                : hasOfficialRouteRecord
                  ? "등록 정보 확인"
                  : "선관위에서 확인"}
        </span>
      </header>

      {loading ? (
        <div className="member-sponsorship-account__unavailable" role="status">
          <p>중앙선관위의 공식 후원회 정보를 확인하고 있습니다.</p>
        </div>
      ) : error ? (
        <div className="member-sponsorship-account__unavailable" role="alert">
          <p>{error}</p>
          <div className="member-sponsorship-account__links">
            {onRetry ? (
              <button type="button" onClick={onRetry}>
                다시 확인
              </button>
            ) : null}
            <a
              href={politicalDonationCenterUrl}
              target="_blank"
              rel="noreferrer"
            >
              중앙선관위 후원회 찾기
            </a>
          </div>
        </div>
      ) : hasOfficialRouteRecord ? (
        <div className="member-sponsorship-account__official">
          <p>
            {donationUrl
              ? "중앙선관위 정치후원금센터에서 공식 등록 후원회와 온라인 후원 경로를 확인할 수 있습니다."
              : "중앙선관위 정치후원금센터의 등록 정보에서 최신 후원 방법을 확인해 주세요."}
          </p>
          <div className="member-sponsorship-account__links">
            {donationUrl ? (
              <a href={donationUrl} target="_blank" rel="noreferrer">
                중앙선관위 공식 온라인 후원
              </a>
            ) : sourceUrl ? (
              <a href={sourceUrl} target="_blank" rel="noreferrer">
                중앙선관위 후원회 등록 정보
              </a>
            ) : (
              <a
                href={politicalDonationCenterUrl}
                target="_blank"
                rel="noreferrer"
              >
                중앙선관위 후원회 찾기
              </a>
            )}
          </div>
        </div>
      ) : (
        <div className="member-sponsorship-account__unavailable">
          <p>등록된 후원회와 공식 후원 경로를 중앙선관위에서 확인해 주세요.</p>
          <a href={politicalDonationCenterUrl} target="_blank" rel="noreferrer">
            중앙선관위 후원회 찾기
          </a>
        </div>
      )}

      <p className="member-sponsorship-account__notice">
        이 서비스는 후원금을 모집하거나 결제를 중개하지 않으며 직접 송금
        계좌번호를 제공하지 않습니다. 후원 자격·한도와 최신 정보는 중앙선관위
        공식 페이지에서 확인해 주세요.
      </p>
    </section>
  );
}
