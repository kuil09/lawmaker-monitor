import { useEffect, useState } from "react";

import {
  loadAccountabilitySummary,
  loadAccountabilityTrends,
  loadBillProposalActivity,
  loadLatestVotes,
  loadManifest,
  loadVoteMinutesOpinions
} from "../lib/data.js";

import type {
  AccountabilitySummaryExport,
  AccountabilityTrendsExport,
  BillProposalActivityExport,
  LatestVotesExport,
  Manifest,
  VoteMinutesOpinionsExport
} from "@lawmaker-monitor/schemas";

type BootstrapDataState = {
  latestVotes: LatestVotesExport | null;
  voteMinutesOpinions: VoteMinutesOpinionsExport | null;
  accountabilitySummary: AccountabilitySummaryExport | null;
  accountabilityTrends: AccountabilityTrendsExport | null;
  billProposalActivity: BillProposalActivityExport | null;
  billProposalActivityLoaded: boolean;
  manifest: Manifest | null;
  feedError: string | null;
  voteMinutesOpinionsError: string | null;
  leaderboardError: string | null;
  trendsError: string | null;
  billProposalActivityError: string | null;
};

const initialState: BootstrapDataState = {
  latestVotes: null,
  voteMinutesOpinions: null,
  accountabilitySummary: null,
  accountabilityTrends: null,
  billProposalActivity: null,
  billProposalActivityLoaded: false,
  manifest: null,
  feedError: null,
  voteMinutesOpinionsError: null,
  leaderboardError: null,
  trendsError: null,
  billProposalActivityError: null
};

export function useAppBootstrapData() {
  const [state, setState] = useState<BootstrapDataState>(initialState);

  useEffect(() => {
    let active = true;

    const updateState = (
      updater: (current: BootstrapDataState) => BootstrapDataState
    ) => {
      if (!active) {
        return;
      }

      setState((current) => updater(current));
    };

    void loadLatestVotes()
      .then((latestVotes) => {
        updateState((current) => ({
          ...current,
          latestVotes
        }));
      })
      .catch((error: Error) => {
        updateState((current) => ({
          ...current,
          feedError: `홈 화면 데이터를 불러오지 못했습니다. ${error.message}`
        }));
      });

    void loadVoteMinutesOpinions()
      .then((voteMinutesOpinions) => {
        updateState((current) => ({
          ...current,
          voteMinutesOpinions,
          voteMinutesOpinionsError: null
        }));
      })
      .catch((error: Error) => {
        updateState((current) => ({
          ...current,
          voteMinutesOpinionsError: `표결별 회의록 근거를 불러오지 못했습니다. ${error.message}`
        }));
      });

    void loadAccountabilitySummary()
      .then((accountabilitySummary) => {
        updateState((current) => ({
          ...current,
          accountabilitySummary,
          leaderboardError: accountabilitySummary
            ? null
            : "책임성 랭킹 데이터가 아직 발행되지 않았습니다."
        }));
      })
      .catch((error: Error) => {
        updateState((current) => ({
          ...current,
          leaderboardError: `책임성 랭킹 데이터를 불러오지 못했습니다. ${error.message}`
        }));
      });

    void loadAccountabilityTrends()
      .then((accountabilityTrends) => {
        updateState((current) => ({
          ...current,
          accountabilityTrends
        }));
      })
      .catch((error: Error) => {
        updateState((current) => ({
          ...current,
          trendsError: `추세 차트 데이터를 불러오지 못했습니다. ${error.message}`
        }));
      });

    void loadBillProposalActivity()
      .then((billProposalActivity) => {
        updateState((current) => ({
          ...current,
          billProposalActivity,
          billProposalActivityLoaded: true,
          billProposalActivityError: null
        }));
      })
      .catch((error: Error) => {
        updateState((current) => ({
          ...current,
          billProposalActivityLoaded: true,
          billProposalActivityError: `입법 활동 데이터를 불러오지 못했습니다. ${error.message}`
        }));
      });

    void loadManifest()
      .then((manifest) => {
        updateState((current) => ({
          ...current,
          manifest
        }));
      })
      .catch(() => {
        updateState((current) => ({
          ...current,
          manifest: null
        }));
      });

    return () => {
      active = false;
    };
  }, []);

  return state;
}
