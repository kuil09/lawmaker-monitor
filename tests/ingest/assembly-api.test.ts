import { describe, expect, it } from "vitest";

import {
  buildAssemblyRequest,
  buildBillVoteSummaryRequest,
  buildMemberHistoryRequest,
  buildVoteDetailRequest,
  resolveAssemblyApiConfig
} from "../../packages/ingest/src/assembly-api.js";
import {
  selectRecordedVoteBillRefs,
  validateRecordedVoteSummaryPage
} from "../../packages/ingest/src/scripts/ingest-live.js";

describe("assembly api request builder", () => {
  it("adds common params and includes the configured OpenAPI key in the query string", () => {
    const config = resolveAssemblyApiConfig({
      ASSEMBLY_API_KEY: "fixture-key"
    });

    const request = buildAssemblyRequest(config, config.endpoints.votesPath, {
      AGE: "22",
      BILL_ID: "PRC_A1B2C3D4E5F6"
    });
    const url = new URL(request.url);

    expect(url.origin).toBe("https://open.assembly.go.kr");
    expect(url.pathname).toBe("/portal/openapi/nojepdqqaweusdfbi");
    expect(url.searchParams.get("KEY")).toBe("fixture-key");
    expect(url.searchParams.get("Type")).toBe("xml");
    expect(url.searchParams.get("pIndex")).toBe("1");
    expect(url.searchParams.get("pSize")).toBe("1000");
    expect(request.headers).toEqual({});
  });

  it("builds the official plenary vote-detail request from BILL_ID", () => {
    const config = resolveAssemblyApiConfig();

    const request = buildVoteDetailRequest(config, {
      assemblyNo: "22",
      billId: "PRC_A1B2C3D4E5F6"
    });
    const url = new URL(request.url);

    expect(url.pathname).toBe("/portal/openapi/nojepdqqaweusdfbi");
    expect(url.searchParams.get("AGE")).toBe("22");
    expect(url.searchParams.get("BILL_ID")).toBe("PRC_A1B2C3D4E5F6");
    expect(url.searchParams.get("Type")).toBe("xml");
  });

  it("builds the official bill-vote-summary request from the assembly prefix", () => {
    const config = resolveAssemblyApiConfig({
      ASSEMBLY_API_KEY: "fixture-key"
    });

    const request = buildBillVoteSummaryRequest(config, {
      assemblyNo: "22",
      page: 2,
      rows: 500
    });
    const url = new URL(request.url);

    expect(url.pathname).toBe("/portal/openapi/ncocpgfiaoituanbr");
    expect(url.searchParams.get("KEY")).toBe("fixture-key");
    expect(url.searchParams.get("AGE")).toBe("22");
    expect(url.searchParams.get("LAW_BILL_NO")).toBe("22");
    expect(url.searchParams.get("pIndex")).toBe("2");
    expect(url.searchParams.get("pSize")).toBe("500");
  });

  it("uses canonical official endpoint defaults without env-based path overrides", () => {
    const config = resolveAssemblyApiConfig();

    expect(config.endpoints.memberInfoPath).toBe(
      "/portal/openapi/nwvrqwxyaytdsfvhu"
    );
    expect(config.endpoints.memberProfileAllPath).toBe(
      "/portal/openapi/ALLNAMEMBER"
    );
    expect(config.endpoints.memberHistoryPath).toBe(
      "/portal/openapi/nexgtxtmaamffofof"
    );
    expect(config.endpoints.committeeOverviewPath).toBe(
      "/portal/openapi/nxrvzonlafugpqjuh"
    );
    expect(config.endpoints.committeeRosterPath).toBe(
      "/portal/openapi/nktulghcadyhmiqxi"
    );
    expect(config.endpoints.billVoteSummaryPath).toBe(
      "/portal/openapi/ncocpgfiaoituanbr"
    );
    expect(config.endpoints.votesPath).toBe(
      "/portal/openapi/nojepdqqaweusdfbi"
    );
  });

  it("builds member history requests for bulk paging and direct MONA_CD lookup", () => {
    const config = resolveAssemblyApiConfig({
      ASSEMBLY_API_KEY: "fixture-key",
      ASSEMBLY_PAGE_SIZE: "1000"
    });

    const bulkRequest = buildMemberHistoryRequest(config, {
      page: 2
    });
    const directRequest = buildMemberHistoryRequest(config, {
      rows: 20,
      monaCd: "QUR40502"
    });
    const bulkUrl = new URL(bulkRequest.url);
    const directUrl = new URL(directRequest.url);

    expect(bulkUrl.pathname).toBe("/portal/openapi/nexgtxtmaamffofof");
    expect(bulkUrl.searchParams.get("KEY")).toBe("fixture-key");
    expect(bulkUrl.searchParams.get("pIndex")).toBe("2");
    expect(bulkUrl.searchParams.get("pSize")).toBe("1000");
    expect(bulkUrl.searchParams.get("MONA_CD")).toBeNull();

    expect(directUrl.pathname).toBe("/portal/openapi/nexgtxtmaamffofof");
    expect(directUrl.searchParams.get("KEY")).toBe("fixture-key");
    expect(directUrl.searchParams.get("pIndex")).toBe("1");
    expect(directUrl.searchParams.get("pSize")).toBe("20");
    expect(directUrl.searchParams.get("MONA_CD")).toBe("QUR40502");
  });

  it("requests named vote details only for official recorded-vote summaries", () => {
    const refs = selectRecordedVoteBillRefs({
      summaries: [
        {
          billNo: "2210001",
          billId: "PRC_FIRST"
        },
        {
          billNo: "2212345",
          billId: "PRC_RECORDED"
        }
      ]
    });

    expect(refs).toEqual([
      {
        billNo: "2210001",
        billId: "PRC_FIRST"
      },
      {
        billNo: "2212345",
        billId: "PRC_RECORDED"
      }
    ]);
    expect(refs.map((ref) => ref.billId)).not.toContain(
      "PRC_D2Q4S0G5I3K0X1S2I4L2M2D0B2H8Q2"
    );
  });

  it("fails closed when a recorded-vote id is reused for another bill", () => {
    expect(() =>
      selectRecordedVoteBillRefs({
        summaries: [
          {
            billNo: "2212345",
            billId: "PRC_RECORDED"
          },
          {
            billNo: "2212346",
            billId: "PRC_RECORDED"
          }
        ]
      })
    ).toThrow(/duplicate id/);
  });

  it("rejects incomplete or inconsistent recorded-vote summary pages", () => {
    expect(
      validateRecordedVoteSummaryPage({
        page: 1,
        rawRowCount: 1000,
        parsedRowCount: 1000,
        publishedTotal: 1656,
        expectedTotal: null
      })
    ).toBe(1656);
    expect(() =>
      validateRecordedVoteSummaryPage({
        page: 2,
        rawRowCount: 656,
        parsedRowCount: 655,
        publishedTotal: 1656,
        expectedTotal: 1656
      })
    ).toThrow(/dropped rows during validation/);
    expect(() =>
      validateRecordedVoteSummaryPage({
        page: 2,
        rawRowCount: 656,
        parsedRowCount: 656,
        publishedTotal: 1657,
        expectedTotal: 1656
      })
    ).toThrow(/total changed/);
    expect(() =>
      validateRecordedVoteSummaryPage({
        page: 1,
        rawRowCount: 0,
        parsedRowCount: 0,
        publishedTotal: null,
        expectedTotal: null
      })
    ).toThrow(/no published total/);
  });

  it("rejects duplicate official recorded-vote summaries", () => {
    expect(() =>
      selectRecordedVoteBillRefs({
        summaries: [
          {
            billNo: "2212345",
            billId: "PRC_RECORDED"
          },
          {
            billNo: "2212345",
            billId: "PRC_RECORDED"
          }
        ]
      })
    ).toThrow(/duplicate bill/);
  });
});
