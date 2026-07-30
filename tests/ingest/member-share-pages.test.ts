import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildMemberCardModel,
  extractOfficialMemberPhotoUrl,
  generateMemberSharePages,
  mergeMemberShareSources,
  renderMemberCardSvg,
  resolveMemberPortraitDataUrl
} from "../../scripts/generate-member-share-pages.mjs";

const temporaryDirectories: string[] = [];
const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "member-share-pages-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("mergeMemberShareSources", () => {
  it("keeps the real identity and evidence attached to one member", () => {
    const members = mergeMemberShareSources({
      activityCalendar: {
        assembly: {
          members: [
            {
              memberId: "M001",
              name: "김아라",
              party: "가나다당",
              photoUrl: "https://images.example.test/M001.jpg",
              voteRecordCount: 35
            }
          ]
        }
      },
      accountabilitySummary: {
        items: [
          {
            memberId: "M001",
            name: "김아라",
            party: "가나다당",
            district: "서울 가구",
            totalRecordedVotes: 40
          }
        ]
      },
      memberAssetsIndex: {
        members: [
          {
            memberId: "M001",
            name: "김아라",
            party: "가나다당",
            latestTotal: 1_500_000
          }
        ]
      },
      billProposalActivity: {
        items: [
          {
            memberId: "M001",
            name: "김아라",
            party: "가나다당",
            leadProposalCount: 12
          }
        ]
      }
    });

    expect(members).toHaveLength(1);
    expect(members[0]).toMatchObject({
      memberId: "M001",
      district: "서울 가구",
      photoUrl: "https://images.example.test/M001.jpg",
      activity: { voteRecordCount: 35 },
      accountability: { totalRecordedVotes: 40 },
      assets: { latestTotal: 1_500_000 },
      bills: { leadProposalCount: 12 }
    });
  });

  it("rejects member identifiers that could escape the output directory", () => {
    const members = mergeMemberShareSources({
      activityCalendar: {
        assembly: {
          members: [
            { memberId: "..", name: "경로 이탈", party: "테스트당" },
            { memberId: "safe_M-001", name: "안전 의원", party: "테스트당" }
          ]
        }
      }
    });

    expect(members.map((member) => member.memberId)).toEqual(["safe_M-001"]);
  });
});

describe("generateMemberSharePages", () => {
  it("writes a unique canonical page and 1200x630 OG card from published data", async () => {
    const distDir = await createTemporaryDirectory();
    const payloads: Record<string, unknown> = {
      "https://data.example.test/manifests/latest.json": {
        snapshotId: "snapshot-123",
        updatedAt: "2026-07-30T10:00:00.000Z",
        currentAssembly: { assemblyNo: 22, label: "제22대 국회" },
        exports: {}
      },
      "https://data.example.test/exports/member_activity_calendar.json": {
        generatedAt: "2026-07-30T10:00:00.000Z",
        assemblyLabel: "제22대 국회",
        assembly: {
          members: [
            {
              memberId: "M001",
              name: "김아라",
              party: "가나다당",
              photoUrl: "https://images.example.test/M001.jpg",
              voteRecordCount: 35
            }
          ]
        }
      },
      "https://data.example.test/exports/accountability_summary.json": {
        items: [
          {
            memberId: "M001",
            name: "김아라",
            party: "가나다당",
            district: "서울 가구",
            totalRecordedVotes: 40,
            absentCount: 5,
            partyLineDefectionCount: 2,
            partyLineParticipationCount: 30
          }
        ]
      },
      "https://data.example.test/exports/member_assets_index.json": {
        members: [
          {
            memberId: "M001",
            name: "김아라",
            party: "가나다당",
            district: "서울 가구",
            latestTotal: 1_500_000,
            latestDisclosureDate: "2026-03-26"
          }
        ]
      },
      "https://data.example.test/exports/bill_proposal_activity.json": {
        items: [
          {
            memberId: "M001",
            name: "김아라",
            party: "가나다당",
            district: "서울 가구",
            leadProposalCount: 12,
            leadResultAvailableProposalCount: 7
          }
        ]
      },
      "https://data.example.test/exports/member_statement_summaries/index.json":
        {
          generatedAt: "2026-07-30T11:00:00.000Z",
          promptVersion: "minutes-summary-v5",
          members: [
            {
              memberId: "M001",
              path: "exports/member_statement_summaries/M001.json"
            }
          ]
        },
      "https://data.example.test/exports/member_statement_summaries/M001.json":
        {
          summaries: [
            {
              meetingDate: "2026-07-28",
              agendaTitle: "지역 공공의료 확충의 건"
            }
          ]
        }
    };
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://images.example.test/M001.jpg") {
        return new Response(onePixelPng, {
          status: 200,
          headers: { "Content-Type": "image/png" }
        });
      }

      const payload = payloads[url];

      return payload
        ? new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        : new Response(null, { status: 404 });
    });

    const result = await generateMemberSharePages({
      distDir,
      appBaseUrl: "https://app.example.test/lawmaker-monitor/",
      dataRepoBaseUrl: "https://data.example.test/",
      fetchImpl
    });
    const html = await readFile(
      join(distDir, "members/M001/index.html"),
      "utf8"
    );
    const png = await readFile(join(distDir, "member-cards/M001.png"));
    const cardsManifest = JSON.parse(
      await readFile(join(distDir, "member-cards/index.json"), "utf8")
    );

    expect(result).toMatchObject({ status: "generated", count: 1 });
    expect(html).toContain(
      'content="https://app.example.test/lawmaker-monitor/members/M001/"'
    );
    expect(html).toContain(
      `content="https://app.example.test/lawmaker-monitor/member-cards/M001.png?v=${cardsManifest.cardVersion}"`
    );
    expect(html).toContain(
      "https://app.example.test/lawmaker-monitor/#calendar?member=M001"
    );
    expect(html).toContain(
      "최근 회의록 안건 2026년 7월 28일 · 지역 공공의료 확충의 건"
    );
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(png.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1200);
    expect(png.readUInt32BE(20)).toBe(630);
    const memberModel = buildMemberCardModel(
      mergeMemberShareSources({
        activityCalendar:
          payloads[
            "https://data.example.test/exports/member_activity_calendar.json"
          ],
        accountabilitySummary:
          payloads[
            "https://data.example.test/exports/accountability_summary.json"
          ],
        memberAssetsIndex:
          payloads[
            "https://data.example.test/exports/member_assets_index.json"
          ],
        billProposalActivity:
          payloads[
            "https://data.example.test/exports/bill_proposal_activity.json"
          ]
      })[0],
      {
        appBaseUrl: "https://app.example.test/lawmaker-monitor/",
        assemblyLabel: "제22대 국회",
        generatedAt: "2026-07-30T10:00:00.000Z",
        snapshotId: "snapshot-123"
      }
    );
    const svg = renderMemberCardSvg(memberModel);
    expect(svg).toContain("기록표결 40건 중 불참 5건");
    expect(svg).toContain("대표발의 12건 · 처리결과 확인 7건");
    expect(svg).toContain(">불참</text>");
    expect(svg).toContain(">5건</text>");
    expect(svg).toContain('filter="url(#newsprint)"');
    expect(svg).toContain("<image");
    expect(svg).not.toContain(">김아</text>");
    expect(svg).not.toMatch(/#173c3a|#006b6e|#005357|#3f6455|#245d56/i);
    expect(cardsManifest).toMatchObject({
      snapshotId: "snapshot-123",
      cardVersion: expect.stringMatching(/^[a-f0-9]{16}$/),
      cardRendererVersion: "member-share-card-v2-portrait-required",
      count: 1
    });
  });

  it("fails generation when remote member data is unavailable", async () => {
    const distDir = await createTemporaryDirectory();
    await expect(
      generateMemberSharePages({
        distDir,
        appBaseUrl: "https://app.example.test/lawmaker-monitor/",
        dataRepoBaseUrl: "https://data.example.test/",
        fetchImpl: vi
          .fn()
          .mockResolvedValue(new Response(null, { status: 503 }))
      })
    ).rejects.toThrow("no valid member data was available");
  });
});

describe("member share portraits", () => {
  it("extracts the official portrait from the Assembly member page", () => {
    const html = `
      <span
        class="img"
        style="background-image: url('/static/portal/img/openassm/new/member.png')"
      ></span>
    `;

    expect(
      extractOfficialMemberPhotoUrl(
        html,
        "https://www.assembly.go.kr/portal/assm/assmMemb/member.do"
      )
    ).toBe(
      "https://www.assembly.go.kr/static/portal/img/openassm/new/member.png"
    );
  });

  it("uses the official lightweight portrait variant", async () => {
    const sourceUrl =
      "https://www.assembly.go.kr/static/portal/img/openassm/new/member.png";
    const thumbnailUrl =
      "https://www.assembly.go.kr/static/portal/img/openassm/new/thumb/member.png";
    const fetchImpl = vi.fn(async (url: string) =>
      url === thumbnailUrl
        ? new Response(onePixelPng, {
            status: 200,
            headers: { "Content-Type": "image/png" }
          })
        : new Response(null, { status: 404 })
    );

    const portrait = await resolveMemberPortraitDataUrl({
      member: {
        memberId: "M001",
        name: "김아라",
        photoUrl: sourceUrl
      },
      assemblyNo: 22,
      fetchImpl,
      warnings: [],
      timeoutMs: 1_000
    });

    expect(portrait).toBe(
      `data:image/png;base64,${onePixelPng.toString("base64")}`
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      thumbnailUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: "https://www.assembly.go.kr/"
        })
      })
    );
    expect(fetchImpl).not.toHaveBeenCalledWith(sourceUrl, expect.anything());
  });

  it("backfills a missing published portrait from the official member page", async () => {
    const pageUrl =
      "https://www.assembly.go.kr/portal/assm/assmMemb/member.do?monaCd=M001&st=22&viewType=CONTBODY";
    const photoUrl =
      "https://www.assembly.go.kr/static/portal/img/openassm/M001.jpg";
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === pageUrl) {
        return new Response(
          `<span style="background-image: url('/static/portal/img/openassm/M001.jpg')"></span>`,
          {
            status: 200,
            headers: { "Content-Type": "text/html" }
          }
        );
      }
      if (url === photoUrl) {
        return new Response(onePixelPng, {
          status: 200,
          headers: { "Content-Type": "image/png" }
        });
      }
      return new Response(null, { status: 404 });
    });

    const portrait = await resolveMemberPortraitDataUrl({
      member: {
        memberId: "M001",
        name: "김아라",
        photoUrl: null
      },
      assemblyNo: 22,
      fetchImpl,
      warnings: [],
      timeoutMs: 1_000
    });

    expect(portrait).toBe(
      `data:image/png;base64,${onePixelPng.toString("base64")}`
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      pageUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: "https://www.assembly.go.kr/"
        })
      })
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      photoUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          Referer: "https://www.assembly.go.kr/"
        })
      })
    );
  });

  it("retries a transient portrait response before using the official fallback", async () => {
    let imageAttempts = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://images.example.test/M001.jpg") {
        imageAttempts += 1;
        if (imageAttempts < 3) {
          return new Response(null, { status: 503 });
        }
        return new Response(onePixelPng, {
          status: 200,
          headers: { "Content-Type": "image/png" }
        });
      }
      return new Response(null, { status: 404 });
    });

    const portrait = await resolveMemberPortraitDataUrl({
      member: {
        memberId: "M001",
        name: "김아라",
        photoUrl: "https://images.example.test/M001.jpg"
      },
      assemblyNo: 22,
      fetchImpl,
      warnings: [],
      timeoutMs: 1_000
    });

    expect(portrait).toBe(
      `data:image/png;base64,${onePixelPng.toString("base64")}`
    );
    expect(imageAttempts).toBe(3);
  });

  it("refuses to render a card without a verified portrait", () => {
    expect(() =>
      renderMemberCardSvg({
        memberId: "M001",
        name: "김아라",
        photoUrl: null
      })
    ).toThrow("a portrait is required");
  });
});
