import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { LinkSimpleIcon } from "@phosphor-icons/react/dist/csr/LinkSimple";
import { ShareNetworkIcon } from "@phosphor-icons/react/dist/csr/ShareNetwork";
import { useEffect, useState } from "react";

import {
  buildMemberCanonicalUrl,
  buildMemberCardImageUrl,
  buildMemberShareData
} from "../lib/member-share.js";
import { writeClipboardText } from "../lib/sponsorship-account.js";
import "../styles/member-share.css";

type MemberPerformanceShareCardProps = {
  member: {
    memberId: string;
    name: string;
    party?: string | null;
    district?: string | null;
  };
};

export function MemberPerformanceShareCard({
  member
}: MemberPerformanceShareCardProps) {
  const [feedback, setFeedback] = useState("");
  const [isSharing, setIsSharing] = useState(false);
  const [imageUnavailable, setImageUnavailable] = useState(false);
  const canonicalUrl = buildMemberCanonicalUrl(member.memberId);
  const cardImageUrl = buildMemberCardImageUrl(member.memberId);
  const affiliation = [member.party, member.district ?? "선출 유형 미확인"]
    .filter(Boolean)
    .join(" · ");

  useEffect(() => {
    setFeedback("");
    setIsSharing(false);
    setImageUnavailable(false);
  }, [member.memberId]);

  async function copyLink(): Promise<void> {
    try {
      await writeClipboardText(canonicalUrl);
      setFeedback("의원 실적 카드 링크를 복사했습니다.");
    } catch {
      setFeedback("링크를 복사하지 못했습니다. 브라우저 권한을 확인해 주세요.");
    }
  }

  async function shareCard(): Promise<void> {
    setIsSharing(true);
    setFeedback("");

    try {
      const shareData = buildMemberShareData(member);
      if (typeof navigator.share === "function") {
        await navigator.share(shareData);
        setFeedback("의원 실적 카드 공유를 완료했습니다.");
        return;
      }

      await writeClipboardText(shareData.url ?? canonicalUrl);
      setFeedback("공유할 의원 실적 카드 링크를 복사했습니다.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setFeedback("의원 실적 카드 공유를 준비하지 못했습니다.");
    } finally {
      setIsSharing(false);
    }
  }

  return (
    <section
      className="member-performance-share"
      aria-labelledby={`member-performance-share-${member.memberId}`}
    >
      <header className="member-performance-share__header">
        <div>
          <p className="section-label">외부 공유 미리보기</p>
          <h3 id={`member-performance-share-${member.memberId}`}>
            의원 실적 카드
          </h3>
        </div>
        <span>공개 기록 자동 갱신</span>
      </header>

      <div className="member-performance-share__content">
        <div className="member-performance-share__preview">
          {!imageUnavailable ? (
            <img
              src={cardImageUrl}
              alt={`${member.name} 의원 실적 카드 미리보기`}
              loading="lazy"
              onError={() => setImageUnavailable(true)}
            />
          ) : (
            <div
              className="member-performance-share__preview-fallback"
              role="img"
              aria-label={`${member.name} 의원 실적 카드 미리보기`}
            >
              <small>WATCH QUEUE · 의원 기록 카드</small>
              <strong>{member.name}</strong>
              <span>{affiliation}</span>
              <p>프로덕션 빌드에서 최신 공개 기록 카드가 생성됩니다.</p>
            </div>
          )}
        </div>

        <div className="member-performance-share__body">
          <p>
            이 미리보기가 SNS·메신저 링크 카드로 표시됩니다. 수치는 빌드 시점의
            공식 공개 기록과 분모를 기준으로 자동 갱신됩니다.
          </p>
          <div className="member-performance-share__actions">
            <button type="button" onClick={() => void copyLink()}>
              <LinkSimpleIcon aria-hidden="true" size={18} weight="bold" />
              링크 복사
            </button>
            <button
              type="button"
              className="is-primary"
              disabled={isSharing}
              onClick={() => void shareCard()}
            >
              <ShareNetworkIcon aria-hidden="true" size={18} weight="bold" />
              {isSharing ? "공유 준비 중" : "실적 카드 공유"}
            </button>
          </div>
          <a href={canonicalUrl} target="_blank" rel="noreferrer">
            공개 카드 링크 열기
            <ArrowSquareOutIcon aria-hidden="true" size={15} weight="bold" />
          </a>
          <p role="status" aria-live="polite">
            {feedback}
          </p>
        </div>
      </div>
    </section>
  );
}
