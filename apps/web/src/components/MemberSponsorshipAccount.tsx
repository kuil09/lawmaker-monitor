import { useId, useState } from "react";

import {
  buildSponsorshipAccountCopyText,
  isVerifiedSponsorshipAccount,
  writeClipboardText
} from "../lib/sponsorship-account.js";
import "../styles/member-share.css";

import type { MemberSponsorshipAccount } from "@lawmaker-monitor/schemas";

type CopyState = {
  kind: "idle" | "success" | "error";
  message: string;
};

type MemberSponsorshipAccountProps = {
  account?: MemberSponsorshipAccount | null;
  memberName?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  onCopy?: (kind: "account-number" | "full-record") => void;
};

const idleCopyState: CopyState = {
  kind: "idle",
  message: ""
};
const politicalDonationCenterUrl =
  "https://www.give.go.kr/portal/supporter/supporterSearch/list.do?menuNo=200025";

function formatVerifiedDate(value: string): string {
  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(parsedDate);
}

export function MemberSponsorshipAccount({
  account,
  memberName,
  loading = false,
  error = null,
  onRetry,
  onCopy
}: MemberSponsorshipAccountProps) {
  const titleId = useId();
  const [copyState, setCopyState] = useState<CopyState>(idleCopyState);
  const isVerified = isVerifiedSponsorshipAccount(account);

  const copyValue = async (
    value: string,
    kind: "account-number" | "full-record",
    successMessage: string
  ): Promise<void> => {
    try {
      await writeClipboardText(value);
      setCopyState({ kind: "success", message: successMessage });
      onCopy?.(kind);
    } catch {
      setCopyState({
        kind: "error",
        message:
          "복사하지 못했습니다. 브라우저의 클립보드 권한을 확인해 주세요."
      });
    }
  };

  return (
    <section className="member-sponsorship-account" aria-labelledby={titleId}>
      <header className="member-sponsorship-account__header">
        <div>
          <p className="section-label">공식 후원 정보</p>
          <h3 id={titleId}>
            {memberName ? `${memberName} 의원 후원계좌` : "국회의원 후원계좌"}
          </h3>
        </div>
        <span
          className={`member-sponsorship-account__status member-sponsorship-account__status--${
            isVerified ? "verified" : "unavailable"
          }`}
        >
          {loading
            ? "확인 중"
            : error
              ? "불러오기 실패"
              : isVerified
                ? "계좌 확인 완료"
                : "복사 불가"}
        </span>
      </header>

      {loading ? (
        <div className="member-sponsorship-account__unavailable" role="status">
          <p>공식 후원계좌 공개 여부를 확인하고 있습니다.</p>
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
      ) : isVerified ? (
        <>
          <div
            className="member-sponsorship-account__direct"
            role="group"
            aria-label={`${memberName ?? "국회의원"} 후원회 계좌`}
          >
            <div className="member-sponsorship-account__direct-copy">
              <p>송금 계좌번호</p>
              <strong>{account.accountNumber}</strong>
              <span>
                {account.bankName} · 예금주 {account.accountHolder}
              </span>
            </div>
            <button
              type="button"
              className="member-sponsorship-account__copy-primary"
              onClick={() => {
                void copyValue(
                  account.accountNumber,
                  "account-number",
                  "계좌번호를 복사했습니다."
                );
              }}
            >
              계좌번호 복사
            </button>
          </div>

          <dl className="member-sponsorship-account__details">
            <div>
              <dt>은행</dt>
              <dd>{account.bankName}</dd>
            </div>
            <div>
              <dt>예금주</dt>
              <dd>{account.accountHolder}</dd>
            </div>
            <div>
              <dt>공식 확인일</dt>
              <dd>{formatVerifiedDate(account.verifiedAt)}</dd>
            </div>
          </dl>

          <div className="member-sponsorship-account__actions">
            <button
              type="button"
              onClick={() => {
                void copyValue(
                  buildSponsorshipAccountCopyText(account, memberName),
                  "full-record",
                  "계좌 정보와 공식 출처를 복사했습니다."
                );
              }}
            >
              계좌 정보 전체 복사
            </button>
          </div>

          <div className="member-sponsorship-account__links">
            <a href={account.sourceUrl} target="_blank" rel="noreferrer">
              공식 출처 확인
            </a>
            {account.donationUrl ? (
              <a href={account.donationUrl} target="_blank" rel="noreferrer">
                공식 후원 안내
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
        </>
      ) : (
        <div className="member-sponsorship-account__unavailable">
          <p>
            {account?.status === "unverified"
              ? account.donationUrl
                ? "공식 후원회와 온라인 후원 경로는 확인했지만, 직접 계좌번호는 의원 공식 채널과 대조 중이라 표시하거나 복사하지 않습니다."
                : "공식 출처와 대조 중이라 계좌번호를 표시하거나 복사하지 않습니다."
              : account?.status === "superseded"
                ? "변경되었거나 종료된 계좌라 계좌번호를 표시하거나 복사하지 않습니다."
                : "공식적으로 확인된 후원계좌 정보가 없습니다."}
          </p>
          {account ? (
            <div className="member-sponsorship-account__links">
              <a href={account.sourceUrl} target="_blank" rel="noreferrer">
                {account.status === "superseded"
                  ? "변경 기록의 공식 출처"
                  : "후원회 등록 정보 확인"}
              </a>
              {account.donationUrl ? (
                <a href={account.donationUrl} target="_blank" rel="noreferrer">
                  공식 후원 페이지
                </a>
              ) : null}
            </div>
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
      )}

      <p
        className={`member-sponsorship-account__copy-feedback member-sponsorship-account__copy-feedback--${copyState.kind}`}
        role="status"
        aria-live="polite"
      >
        {copyState.message}
      </p>

      <p className="member-sponsorship-account__notice">
        이 서비스는 후원금을 모집하거나 결제를 중개하지 않습니다. 송금 전 공식
        출처의 최신 계좌와 후원 자격·한도를 다시 확인해 주세요.
      </p>
    </section>
  );
}
