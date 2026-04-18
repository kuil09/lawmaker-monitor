import { useEffect, useState } from "react";

import {
  loadAccountabilitySummary,
  loadAccountabilityTrends,
  loadLatestVotes,
  loadManifest
} from "../lib/data.js";

import type {
  AccountabilitySummaryExport,
  AccountabilityTrendsExport,
  LatestVotesExport,
  Manifest
} from "@lawmaker-monitor/schemas";

type BootstrapDataState = {
  latestVotes: LatestVotesExport | null;
  accountabilitySummary: AccountabilitySummaryExport | null;
  accountabilityTrends: AccountabilityTrendsExport | null;
  manifest: Manifest | null;
  feedError: string | null;
  leaderboardError: string | null;
  trendsError: string | null;
};

const initialState: BootstrapDataState = {
  latestVotes: null,
  accountabilitySummary: null,
  accountabilityTrends: null,
  manifest: null,
  feedError: null,
  leaderboardError: null,
  trendsError: null
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
