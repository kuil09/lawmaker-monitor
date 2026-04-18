import { useCallback, useEffect, useRef, useState } from "react";

import {
  loadMemberActivityCalendar,
  loadMemberActivityCalendarMemberDetail
} from "../lib/data.js";

import type {
  Manifest,
  MemberActivityCalendarExport,
  MemberActivityCalendarMember,
  MemberActivityCalendarMemberDetailExport
} from "@lawmaker-monitor/schemas";

function buildEmbeddedActivityMemberDetail(
  activityCalendar: MemberActivityCalendarExport,
  member: MemberActivityCalendarMember
): MemberActivityCalendarMemberDetailExport {
  return {
    generatedAt: activityCalendar.generatedAt,
    snapshotId: activityCalendar.snapshotId,
    assemblyNo: activityCalendar.assemblyNo,
    assemblyLabel: activityCalendar.assemblyLabel,
    memberId: member.memberId,
    voteRecords: member.voteRecords ?? []
  };
}

export function useActivityCalendarData(args: {
  manifest: Manifest | null;
  shouldLoad: boolean;
}) {
  const [activityCalendar, setActivityCalendar] =
    useState<MemberActivityCalendarExport | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [isActivityLoading, setIsActivityLoading] = useState(false);
  const [activityMemberDetails, setActivityMemberDetails] = useState<
    Record<string, MemberActivityCalendarMemberDetailExport | undefined>
  >({});
  const [activityMemberDetailErrors, setActivityMemberDetailErrors] = useState<
    Record<string, string | null | undefined>
  >({});
  const [activityMemberDetailLoading, setActivityMemberDetailLoading] =
    useState<Record<string, boolean | undefined>>({});

  const activityCalendarRef = useRef<MemberActivityCalendarExport | null>(null);
  const activityMemberDetailsRef = useRef<
    Record<string, MemberActivityCalendarMemberDetailExport | undefined>
  >({});
  const activityMemberDetailLoadingRef = useRef<
    Record<string, boolean | undefined>
  >({});
  const activityMemberDetailRequestsRef = useRef<
    Record<string, Promise<void> | undefined>
  >({});

  activityCalendarRef.current = activityCalendar;
  activityMemberDetailsRef.current = activityMemberDetails;
  activityMemberDetailLoadingRef.current = activityMemberDetailLoading;

  const ensureActivityCalendarLoaded = useCallback(async () => {
    if (activityCalendarRef.current || isActivityLoading) {
      return;
    }

    setIsActivityLoading(true);
    setActivityError(null);

    try {
      const payload = await loadMemberActivityCalendar(args.manifest);
      if (!payload) {
        setActivityError("활동 캘린더 데이터가 아직 발행되지 않았습니다.");
        return;
      }

      setActivityCalendar(payload);
      setActivityMemberDetails({});
      setActivityMemberDetailErrors({});
      setActivityMemberDetailLoading({});
    } catch (error) {
      setActivityError(
        `활동 캘린더 데이터를 불러오지 못했습니다. ${(error as Error).message}`
      );
    } finally {
      setIsActivityLoading(false);
    }
  }, [args.manifest, isActivityLoading]);

  useEffect(() => {
    if (!args.shouldLoad) {
      return;
    }

    void ensureActivityCalendarLoaded();
  }, [args.shouldLoad, ensureActivityCalendarLoaded]);

  const ensureActivityMemberDetailLoaded = useCallback(
    async (
      member: MemberActivityCalendarMember,
      force = false
    ): Promise<void> => {
      const activityCalendarValue = activityCalendarRef.current;
      if (!activityCalendarValue) {
        return;
      }

      const pendingRequest =
        activityMemberDetailRequestsRef.current[member.memberId];
      if (pendingRequest) {
        await pendingRequest;
        return;
      }

      if (
        !force &&
        (activityMemberDetailsRef.current[member.memberId] ||
          activityMemberDetailLoadingRef.current[member.memberId])
      ) {
        return;
      }

      const request = (async () => {
        setActivityMemberDetailLoading((current) => ({
          ...current,
          [member.memberId]: true
        }));
        setActivityMemberDetailErrors((current) => ({
          ...current,
          [member.memberId]: null
        }));

        try {
          if (
            member.voteRecordCount === 0 ||
            (member.voteRecords?.length ?? 0) >= member.voteRecordCount
          ) {
            setActivityMemberDetails((current) => ({
              ...current,
              [member.memberId]: buildEmbeddedActivityMemberDetail(
                activityCalendarValue,
                member
              )
            }));
            return;
          }

          const payload = await loadMemberActivityCalendarMemberDetail(
            member.voteRecordsPath
          );
          if (!payload) {
            setActivityMemberDetailErrors((current) => ({
              ...current,
              [member.memberId]:
                "의안별 표결 기록 데이터가 아직 발행되지 않았습니다."
            }));
            return;
          }

          setActivityMemberDetails((current) => ({
            ...current,
            [member.memberId]: payload
          }));
        } catch (error) {
          setActivityMemberDetailErrors((current) => ({
            ...current,
            [member.memberId]: `의안별 표결 기록을 불러오지 못했습니다. ${(error as Error).message}`
          }));
        } finally {
          delete activityMemberDetailRequestsRef.current[member.memberId];
          setActivityMemberDetailLoading((current) => ({
            ...current,
            [member.memberId]: false
          }));
        }
      })();

      activityMemberDetailRequestsRef.current[member.memberId] = request;
      await request;
    },
    []
  );

  const retryActivityMemberDetail = useCallback(
    (member: MemberActivityCalendarMember): void => {
      setActivityMemberDetails((current) => {
        const next = { ...current };
        delete next[member.memberId];
        return next;
      });
      void ensureActivityMemberDetailLoaded(member, true);
    },
    [ensureActivityMemberDetailLoaded]
  );

  return {
    activityCalendar,
    activityError,
    isActivityLoading,
    activityMemberDetails,
    activityMemberDetailErrors,
    activityMemberDetailLoading,
    ensureActivityCalendarLoaded,
    ensureActivityMemberDetailLoaded,
    retryActivityMemberDetail
  };
}
