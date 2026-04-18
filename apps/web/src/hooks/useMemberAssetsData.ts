import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { loadMemberAssetsHistory, loadMemberAssetsIndex } from "../lib/data.js";
import { applyMemberAssetsIndexRealEstateFallbacks } from "../lib/member-assets.js";

import type { RouteState } from "../lib/route-state.js";
import type {
  Manifest,
  MemberActivityCalendarMember,
  MemberAssetsHistoryExport,
  MemberAssetsIndexExport
} from "@lawmaker-monitor/schemas";

function buildHomePrefetchIds(
  memberAssetsIndex: MemberAssetsIndexExport | null,
  memberAssetHistories: Record<string, MemberAssetsHistoryExport | undefined>
): string[] {
  const resolvedIndex = applyMemberAssetsIndexRealEstateFallbacks(
    memberAssetsIndex,
    memberAssetHistories
  );
  const resolvedMembers = resolvedIndex?.members ?? [];

  return [
    ...new Set([
      ...[...resolvedMembers]
        .sort((left, right) => right.latestTotal - left.latestTotal)
        .slice(0, 10)
        .map((item) => item.memberId),
      ...[...resolvedMembers]
        .filter((item) => item.latestRealEstateTotal != null)
        .sort(
          (left, right) =>
            (right.latestRealEstateTotal ?? Number.NEGATIVE_INFINITY) -
            (left.latestRealEstateTotal ?? Number.NEGATIVE_INFINITY)
        )
        .slice(0, 10)
        .map((item) => item.memberId)
    ])
  ];
}

export function useMemberAssetsData(args: {
  manifest: Manifest | null;
  routeState: RouteState;
}) {
  const [memberAssetsIndex, setMemberAssetsIndex] =
    useState<MemberAssetsIndexExport | null>(null);
  const [memberAssetsIndexError, setMemberAssetsIndexError] = useState<
    string | null
  >(null);
  const [memberAssetHistories, setMemberAssetHistories] = useState<
    Record<string, MemberAssetsHistoryExport | undefined>
  >({});
  const [memberAssetHistoryErrors, setMemberAssetHistoryErrors] = useState<
    Record<string, string | null | undefined>
  >({});
  const [memberAssetHistoryLoading, setMemberAssetHistoryLoading] = useState<
    Record<string, boolean | undefined>
  >({});

  const memberAssetsIndexRef = useRef<MemberAssetsIndexExport | null>(null);
  const memberAssetHistoriesRef = useRef<
    Record<string, MemberAssetsHistoryExport | undefined>
  >({});
  const memberAssetHistoryLoadingRef = useRef<
    Record<string, boolean | undefined>
  >({});
  const memberAssetHistoryRequestsRef = useRef<
    Record<string, Promise<void> | undefined>
  >({});

  memberAssetsIndexRef.current = memberAssetsIndex;
  memberAssetHistoriesRef.current = memberAssetHistories;
  memberAssetHistoryLoadingRef.current = memberAssetHistoryLoading;

  useEffect(() => {
    const shouldLoadIndex =
      args.routeState.route === "home" ||
      args.routeState.route === "calendar" ||
      args.routeState.route === "map";

    if (!shouldLoadIndex || memberAssetsIndex || memberAssetsIndexError) {
      return;
    }

    void loadMemberAssetsIndex(args.manifest)
      .then((payload) => {
        setMemberAssetsIndex(payload);
        setMemberAssetsIndexError(null);
      })
      .catch((error: Error) => {
        setMemberAssetsIndexError(
          `재산 공개 데이터를 불러오지 못했습니다. ${error.message}`
        );
      });
  }, [
    args.manifest,
    args.routeState.route,
    memberAssetsIndex,
    memberAssetsIndexError
  ]);

  const ensureMemberAssetHistoryLoadedByIndexEntry = useCallback(
    async (
      indexEntry: NonNullable<MemberAssetsIndexExport>["members"][number],
      force = false
    ): Promise<void> => {
      const pendingRequest =
        memberAssetHistoryRequestsRef.current[indexEntry.memberId];
      if (pendingRequest) {
        await pendingRequest;
        return;
      }

      if (
        !force &&
        (memberAssetHistoriesRef.current[indexEntry.memberId] ||
          memberAssetHistoryLoadingRef.current[indexEntry.memberId])
      ) {
        return;
      }

      const request = (async () => {
        setMemberAssetHistoryLoading((current) => ({
          ...current,
          [indexEntry.memberId]: true
        }));
        setMemberAssetHistoryErrors((current) => ({
          ...current,
          [indexEntry.memberId]: null
        }));

        try {
          const payload = await loadMemberAssetsHistory(indexEntry.historyPath);
          if (!payload) {
            setMemberAssetHistoryErrors((current) => ({
              ...current,
              [indexEntry.memberId]:
                "재산 공개 이력이 아직 발행되지 않았습니다."
            }));
            return;
          }

          setMemberAssetHistories((current) => ({
            ...current,
            [indexEntry.memberId]: payload
          }));
        } catch (error) {
          setMemberAssetHistoryErrors((current) => ({
            ...current,
            [indexEntry.memberId]: `재산 공개 이력을 불러오지 못했습니다. ${(error as Error).message}`
          }));
        } finally {
          delete memberAssetHistoryRequestsRef.current[indexEntry.memberId];
          setMemberAssetHistoryLoading((current) => ({
            ...current,
            [indexEntry.memberId]: false
          }));
        }
      })();

      memberAssetHistoryRequestsRef.current[indexEntry.memberId] = request;
      await request;
    },
    []
  );

  useEffect(() => {
    const shouldBackfillMissingRealEstate =
      args.routeState.route === "home" ||
      (args.routeState.route === "map" &&
        args.routeState.metric === "realEstate");

    if (!shouldBackfillMissingRealEstate || !memberAssetsIndex) {
      return;
    }

    const missingRealEstateEntries = memberAssetsIndex.members.filter(
      (entry) =>
        entry.latestRealEstateTotal == null &&
        !memberAssetHistoriesRef.current[entry.memberId] &&
        !memberAssetHistoryLoadingRef.current[entry.memberId]
    );

    if (missingRealEstateEntries.length === 0) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const batchSize = 6;
      for (
        let start = 0;
        start < missingRealEstateEntries.length;
        start += batchSize
      ) {
        if (cancelled) {
          return;
        }

        const batch = missingRealEstateEntries.slice(start, start + batchSize);
        await Promise.all(
          batch.map((entry) =>
            ensureMemberAssetHistoryLoadedByIndexEntry(entry)
          )
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    args.routeState,
    memberAssetsIndex,
    ensureMemberAssetHistoryLoadedByIndexEntry
  ]);

  const homePrefetchIds = useMemo(
    () => buildHomePrefetchIds(memberAssetsIndex, memberAssetHistories),
    [memberAssetsIndex, memberAssetHistories]
  );

  useEffect(() => {
    if (
      args.routeState.route !== "home" ||
      !memberAssetsIndex ||
      homePrefetchIds.length === 0
    ) {
      return;
    }

    let cancelled = false;

    void (async () => {
      for (const memberId of homePrefetchIds) {
        if (cancelled) {
          return;
        }

        const entry = memberAssetsIndex.members.find(
          (member) => member.memberId === memberId
        );
        if (!entry) {
          continue;
        }

        if (
          memberAssetHistoriesRef.current[memberId] ||
          memberAssetHistoryLoadingRef.current[memberId]
        ) {
          continue;
        }

        await ensureMemberAssetHistoryLoadedByIndexEntry(entry);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    args.routeState.route,
    ensureMemberAssetHistoryLoadedByIndexEntry,
    homePrefetchIds,
    memberAssetsIndex
  ]);

  const ensureMemberAssetHistoryLoaded = useCallback(
    async (
      member: MemberActivityCalendarMember,
      force = false
    ): Promise<void> => {
      const indexPayload = memberAssetsIndexRef.current;
      if (!indexPayload) {
        return;
      }

      const indexEntry = indexPayload.members.find(
        (entry) => entry.memberId === member.memberId
      );
      if (!indexEntry) {
        return;
      }

      await ensureMemberAssetHistoryLoadedByIndexEntry(indexEntry, force);
    },
    [ensureMemberAssetHistoryLoadedByIndexEntry]
  );

  const retryMemberAssetHistory = useCallback(
    (member: MemberActivityCalendarMember): void => {
      setMemberAssetHistories((current) => {
        const next = { ...current };
        delete next[member.memberId];
        return next;
      });
      void ensureMemberAssetHistoryLoaded(member, true);
    },
    [ensureMemberAssetHistoryLoaded]
  );

  const resolvedMemberAssetsIndex = useMemo(
    () =>
      applyMemberAssetsIndexRealEstateFallbacks(
        memberAssetsIndex,
        memberAssetHistories
      ),
    [memberAssetsIndex, memberAssetHistories]
  );

  return {
    memberAssetsIndex,
    memberAssetsIndexError,
    memberAssetHistories,
    memberAssetHistoryErrors,
    memberAssetHistoryLoading,
    resolvedMemberAssetsIndex,
    ensureMemberAssetHistoryLoaded,
    retryMemberAssetHistory
  };
}
