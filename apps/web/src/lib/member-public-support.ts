export type PublicSupportEvidenceKind =
  | "statutory"
  | "estimated"
  | "actual-unavailable"
  | "shared-excluded";

export type PublicSupportSource = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  description: string;
};

export type PublicSupportStaffGrade = {
  gradeLabel: string;
  headcount: number;
  referenceStep: string;
  monthlyPerPersonWon: number;
  annualAmountWon: number;
  sharePercent: number;
  tone: string;
};

export type PublicSupportCategory = {
  title: string;
  evidenceKind: PublicSupportEvidenceKind;
  statusLabel: string;
  description: string;
  sourceIds: string[];
};

export type MemberPublicSupportModel = {
  fiscalYear: number;
  staffHeadcount: number;
  monthlyStaffBaseEstimateWon: number;
  annualStaffBaseEstimateWon: number;
  staffGrades: PublicSupportStaffGrade[];
  categories: PublicSupportCategory[];
  sources: PublicSupportSource[];
  limitations: string[];
};

type StaffGradeInput = Omit<
  PublicSupportStaffGrade,
  "annualAmountWon" | "sharePercent"
>;

const fiscalYear = 2026;

const staffGradeInputs: StaffGradeInput[] = [
  {
    gradeLabel: "4급 상당",
    headcount: 2,
    referenceStep: "21호봉",
    monthlyPerPersonWon: 5_669_800,
    tone: "teal-strong"
  },
  {
    gradeLabel: "5급 상당",
    headcount: 2,
    referenceStep: "24호봉",
    monthlyPerPersonWon: 5_345_200,
    tone: "teal"
  },
  {
    gradeLabel: "6급 상당",
    headcount: 1,
    referenceStep: "11호봉",
    monthlyPerPersonWon: 3_580_000,
    tone: "blue"
  },
  {
    gradeLabel: "7급 상당",
    headcount: 1,
    referenceStep: "9호봉",
    monthlyPerPersonWon: 3_027_100,
    tone: "sky"
  },
  {
    gradeLabel: "8급 상당",
    headcount: 1,
    referenceStep: "8호봉",
    monthlyPerPersonWon: 2_622_400,
    tone: "slate"
  },
  {
    gradeLabel: "9급 상당",
    headcount: 1,
    referenceStep: "7호봉",
    monthlyPerPersonWon: 2_309_900,
    tone: "slate-light"
  }
];

const sources: PublicSupportSource[] = [
  {
    id: "staff-quota",
    title: "국회의원수당 등에 관한 법률 별표 1",
    publisher: "국가법령정보센터",
    url: "https://www.law.go.kr/LSW/flDownload.do?bylClsCd=110201&flSeq=111016407&gubun=",
    description: "국회의원 1명당 보좌직원 정원과 직급을 확인합니다."
  },
  {
    id: "staff-pay-table",
    title: "2026년 일반직공무원 봉급표",
    publisher: "인사혁신처",
    url: "https://www.mpm.go.kr/mpm/info/resultPay/bizSalary/2026/",
    description:
      "국회의원 보좌직원 직급별 기준 호봉과 월 기본봉급을 확인합니다."
  },
  {
    id: "member-allowance-law",
    title: "국회의원수당 등에 관한 법률",
    publisher: "국가법령정보센터",
    url: "https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=238915",
    description:
      "수당, 입법활동비, 특별활동비 등 의원 개인 지급 항목의 법적 근거입니다."
  },
  {
    id: "member-allowance-rule",
    title: "국회의원수당 등에 관한 규칙",
    publisher: "국가법령정보센터",
    url: "https://www.law.go.kr/LSW/lsInfoP.do?ancYnChk=&chrClsCd=010202&efYd=20230621&lsiSeq=252577&urlMode=lsInfoP",
    description: "의원 수당 등의 지급 기준과 절차를 확인합니다."
  },
  {
    id: "assembly-budget",
    title: "2026년도 예산안 위원회별 분석: 국회운영위원회",
    publisher: "국회예산정책처",
    url: "https://www.nabo.go.kr/board/file/bulkDown.do?bid=19&idx=9020",
    description:
      "국회 예산의 사업별 편성 근거를 확인하되, 공통비용은 의원 개인에게 배분하지 않습니다."
  }
];

export function formatWonExact(value: number): string {
  const absolute = Math.abs(Math.round(value));
  const eok = Math.floor(absolute / 100_000_000);
  const remainderAfterEok = absolute % 100_000_000;
  const man = Math.floor(remainderAfterEok / 10_000);
  const won = remainderAfterEok % 10_000;
  const parts: string[] = [];

  if (eok > 0) {
    parts.push(`${eok.toLocaleString("ko-KR")}억`);
  }
  if (man > 0) {
    parts.push(`${man.toLocaleString("ko-KR")}만`);
  }
  if (won > 0 || parts.length === 0) {
    parts.push(won.toLocaleString("ko-KR"));
  }

  return `${value < 0 ? "-" : ""}${parts.join(" ")}원`;
}

export function buildMemberPublicSupportModel(): MemberPublicSupportModel {
  const annualAmounts = staffGradeInputs.map(
    (grade) => grade.monthlyPerPersonWon * grade.headcount * 12
  );
  const annualStaffBaseEstimateWon = annualAmounts.reduce(
    (sum, amount) => sum + amount,
    0
  );
  const monthlyStaffBaseEstimateWon = annualStaffBaseEstimateWon / 12;
  const staffHeadcount = staffGradeInputs.reduce(
    (sum, grade) => sum + grade.headcount,
    0
  );
  const staffGrades = staffGradeInputs.map((grade, index) => ({
    ...grade,
    annualAmountWon: annualAmounts[index] ?? 0,
    sharePercent:
      ((annualAmounts[index] ?? 0) / annualStaffBaseEstimateWon) * 100
  }));

  return {
    fiscalYear,
    staffHeadcount,
    monthlyStaffBaseEstimateWon,
    annualStaffBaseEstimateWon,
    staffGrades,
    categories: [
      {
        title: "보좌직원 기본봉급",
        evidenceKind: "estimated",
        statusLabel: "공식 기준 추정",
        description:
          "법정 정원 8명이 모두 근무한다고 가정해 2026년 기준 호봉의 기본봉급만 계산했습니다.",
        sourceIds: ["staff-quota", "staff-pay-table"]
      },
      {
        title: "의원 개인 지급 항목",
        evidenceKind: "statutory",
        statusLabel: "법정 항목 확인",
        description:
          "수당·입법활동비·특별활동비의 근거는 확인했지만, 이 화면에서는 개인별 실제 지급액으로 합산하지 않습니다.",
        sourceIds: ["member-allowance-law", "member-allowance-rule"]
      },
      {
        title: "정책개발·출장 등",
        evidenceKind: "actual-unavailable",
        statusLabel: "개인별 집행 미확보",
        description:
          "발생 건별 실제 집행자료가 필요합니다. 공개자료를 확보하기 전까지 0원으로 간주하지 않습니다.",
        sourceIds: ["assembly-budget"]
      },
      {
        title: "청사·경비·정보시스템",
        evidenceKind: "shared-excluded",
        statusLabel: "개인 배분 제외",
        description:
          "국회 전체가 함께 사용하는 비용은 임의로 의원 수로 나누지 않습니다.",
        sourceIds: ["assembly-budget"]
      }
    ],
    sources,
    limitations: [
      "상여금, 각종 수당, 초과근무수당, 사용자 부담금은 포함하지 않습니다.",
      "결원, 휴직, 중도 임용 등 실제 재직 상태를 반영하지 않습니다.",
      "표시 금액은 의원 개인 소득이나 의원실 실제 집행액이 아닙니다."
    ]
  };
}
