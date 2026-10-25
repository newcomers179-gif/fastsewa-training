import { useIsFocused } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppActive } from "@/hooks/useAppActive";
import { ApiError, api } from "@/lib/api";
import { createHeartbeat } from "@/lib/heartbeat";
import type { RecordResult } from "@/types";

/** Answers that mean "this account cannot record progress here" (a trainer previewing a course): stop asking. */
const NO_PROGRESS_CODES = new Set(["NOT_ENROLLED", "COURSE_NOT_AVAILABLE", "FORBIDDEN"]);

/**
 * Keeps the server's measure of "time spent on this lesson" moving, only while the learner is really
 * there: the lesson screen is in front, the app is in the foreground and, for a video, it is playing.
 * `report` is for the video player; text and picture lessons count simply by being open.
 */
export function useLessonTracker(options: { lessonId: string; enabled: boolean; isVideo: boolean; onProgress: (result: RecordResult) => void }) {
  const { lessonId, enabled, isVideo } = options;
  const focused = useIsFocused();
  const appActive = useAppActive();
  const [playing, setPlaying] = useState(false);
  const [previewOnly, setPreviewOnly] = useState(false);
  const position = useRef<number | undefined>(undefined);
  const onProgress = useRef(options.onProgress);
  onProgress.current = options.onProgress;

  const heartbeat = useMemo(
    () =>
      createHeartbeat({
        getPosition: () => position.current,
        send: async (seconds) => {
          try {
            const result = await api.post<RecordResult>("/progress/lesson", { lessonId, ...(seconds !== undefined ? { positionSeconds: seconds } : {}) });
            onProgress.current(result);
          } catch (error) {
            if (error instanceof ApiError && NO_PROGRESS_CODES.has(error.code)) setPreviewOnly(true);
            // Anything else (no signal, a busy server) just costs this one beat.
          }
        },
      }),
    [lessonId]
  );

  const shouldBeat = enabled && focused && appActive && !previewOnly && (!isVideo || playing);
  useEffect(() => {
    if (shouldBeat) heartbeat.start();
    else heartbeat.stop();
  }, [shouldBeat, heartbeat]);

  // Leaving the screen: one last beat so the resume point is current, then nothing more.
  useEffect(
    () => () => {
      heartbeat.stop();
      heartbeat.dispose();
    },
    [heartbeat]
  );

  const report = useCallback((r: { playing: boolean; position: number }) => {
    position.current = r.position;
    setPlaying(r.playing);
  }, []);

  /** The latest video position, for the "mark as complete" request. */
  const currentPosition = useCallback(() => position.current, []);

  return { report, previewOnly, currentPosition };
}
