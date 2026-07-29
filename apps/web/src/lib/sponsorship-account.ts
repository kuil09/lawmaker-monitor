import type {
  MemberSponsorshipAccount,
  VerifiedMemberSponsorshipAccount
} from "@lawmaker-monitor/schemas";

export function isVerifiedSponsorshipAccount(
  account: MemberSponsorshipAccount | null | undefined
): account is VerifiedMemberSponsorshipAccount {
  return account?.status === "verified";
}

export function buildSponsorshipAccountCopyText(
  account: VerifiedMemberSponsorshipAccount,
  memberName?: string
): string {
  return [
    memberName ? `국회의원: ${memberName}` : null,
    `은행: ${account.bankName}`,
    `계좌번호: ${account.accountNumber}`,
    `예금주: ${account.accountHolder}`,
    `공식 확인일: ${account.verifiedAt}`,
    `공식 출처: ${account.sourceUrl}`
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

export async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const temporaryInput = document.createElement("textarea");
  temporaryInput.value = text;
  temporaryInput.setAttribute("readonly", "");
  temporaryInput.style.position = "fixed";
  temporaryInput.style.opacity = "0";
  document.body.appendChild(temporaryInput);
  temporaryInput.select();

  const copied =
    typeof document.execCommand === "function" && document.execCommand("copy");
  temporaryInput.remove();

  if (!copied) {
    throw new Error("Clipboard access is unavailable.");
  }
}
