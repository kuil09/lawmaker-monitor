import { describe, expect, it, vi } from "vitest";

import {
  compareVerificationMembers,
  pickVerificationMembers,
  resolveProductionUiRoutes
} from "../../scripts/resolve-production-ui-routes.mjs";

describe("compareVerificationMembers", () => {
  it("sorts by name first and memberId second", () => {
    const members = [
      { memberId: "M003", name: "Kim" },
      { memberId: "M001", name: "Kim" },
      { memberId: "M002", name: "Ahn" }
    ];

    expect(members.sort(compareVerificationMembers)).toEqual([
      { memberId: "M002", name: "Ahn" },
      { memberId: "M001", name: "Kim" },
      { memberId: "M003", name: "Kim" }
    ]);
  });
});

describe("pickVerificationMembers", () => {
  it("skips candidates whose published detail file does not resolve", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/exports/member_activity_calendar_members/M001.json")) {
        return new Response(null, { status: 404 });
      }

      return new Response(null, { status: 200 });
    });

    const selectedMembers = await pickVerificationMembers(
      [
        {
          memberId: "M002",
          name: "Bora",
          party: "Alpha",
          voteRecordsPath: "exports/member_activity_calendar_members/M002.json"
        },
        {
          memberId: "M001",
          name: "Ara",
          party: "Alpha",
          voteRecordsPath: "exports/member_activity_calendar_members/M001.json"
        },
        {
          memberId: "M003",
          name: "Duri",
          party: "Beta",
          voteRecordsPath: "exports/member_activity_calendar_members/M003.json"
        }
      ],
      {
        dataRepoBaseUrl: "https://data.example.test/",
        fetchImpl
      }
    );

    expect(selectedMembers.map((member) => member.memberId)).toEqual([
      "M002",
      "M003"
    ]);
  });
});

describe("resolveProductionUiRoutes", () => {
  it("builds live verification URLs from the published manifest and calendar export", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === "https://data.example.test/manifests/latest.json") {
        return new Response(
          JSON.stringify({
            snapshotId: "snapshot-123",
            updatedAt: "2026-03-27T05:43:15.528Z",
            exports: {
              memberActivityCalendar: {
                path: "exports/member_activity_calendar.json"
              }
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (
        url ===
        "https://data.example.test/exports/member_activity_calendar.json"
      ) {
        return new Response(
          JSON.stringify({
            assembly: {
              members: [
                {
                  memberId: "M002",
                  name: "Bora",
                  party: "Alpha",
                  voteRecordsPath:
                    "exports/member_activity_calendar_members/M002.json"
                },
                {
                  memberId: "M001",
                  name: "Ara",
                  party: "Alpha",
                  voteRecordsPath:
                    "exports/member_activity_calendar_members/M001.json"
                },
                {
                  memberId: "M003",
                  name: "Duri",
                  party: "Beta",
                  voteRecordsPath:
                    "exports/member_activity_calendar_members/M003.json"
                }
              ]
            }
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" }
          }
        );
      }

      if (url.endsWith("/exports/member_activity_calendar_members/M001.json")) {
        return new Response(null, { status: 404 });
      }

      return new Response(null, { status: 200 });
    });

    const routes = await resolveProductionUiRoutes({
      appBaseUrl: "https://app.example.test/lawmaker-monitor/",
      dataRepoBaseUrl: "https://data.example.test/",
      fetchImpl
    });

    expect(routes.snapshotId).toBe("snapshot-123");
    expect(routes.single).toMatchObject({
      memberId: "M002",
      name: "Bora",
      hash: "#calendar?member=M002",
      url: "https://app.example.test/lawmaker-monitor/#calendar?member=M002"
    });
    expect(routes.compare.primaryMember).toMatchObject({
      memberId: "M002",
      name: "Bora"
    });
    expect(routes.compare.secondaryMember).toMatchObject({
      memberId: "M003",
      name: "Duri"
    });
    expect(routes.compare.url).toBe(
      "https://app.example.test/lawmaker-monitor/#calendar?member=M002&compare=M003&view=compare"
    );
  });
});
