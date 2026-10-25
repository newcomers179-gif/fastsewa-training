import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import React, { useCallback, useState } from "react";
import { Image, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Markdown } from "@/components/Markdown";
import { QueryGate } from "@/components/QueryGate";
import { ThemedText } from "@/components/ThemedText";
import { VideoPlayer } from "@/components/video/VideoPlayer";
import { Badge, Banner, Button, Card, OfflineBanner, ProgressBar, Screen } from "@/components/ui";
import { BorderRadius, Spacing } from "@/constants/theme";
import { useCertificateActions } from "@/hooks/useCertificateActions";
import { useLang } from "@/hooks/useLang";
import { useLessonTracker } from "@/hooks/useLessonTracker";
import { useOnline } from "@/hooks/useOnline";
import { useTheme } from "@/hooks/useTheme";
import { api } from "@/lib/api";
import { API_BASE_URL } from "@/lib/config";
import { errorMessage, waitText } from "@/lib/errors";
import { afterLesson, resumePosition, secondsStillNeeded, watchPercent } from "@/lib/learning";
import { pick } from "@/lib/format";
import { resolveMediaUrl } from "@/lib/media";
import { keys, lessonOptions, moduleOptions, refreshAfterProgress } from "@/lib/queries";
import { useAppNavigation, type ScreenProps } from "@/navigation/hooks";
import type { LessonDetail, LessonProgressView, RecordResult } from "@/types";

export default function LessonDetailScreen({ route }: ScreenProps<"LessonDetail">) {
  const query = useQuery(lessonOptions(route.params.lessonId));
  return (
    <Screen edges={["bottom", "left", "right"]}>
      {/* keyed by lesson: moving to the next lesson starts a clean tracker and player */}
      <QueryGate query={query}>{(lesson) => <LessonBody key={lesson.id} lesson={lesson} />}</QueryGate>
    </Screen>
  );
}

function LessonBody({ lesson }: { lesson: LessonDetail }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const lang = useLang();
  const online = useOnline();
  const navigation = useAppNavigation();
  const queryClient = useQueryClient();
  const certActions = useCertificateActions();
  const [finished, setFinished] = useState<RecordResult | null>(null);

  const progress = lesson.progress;
  const isVideo = lesson.contentType === "video" && !!lesson.videoUrl;
  const completed = progress.completed;

  /** Every heartbeat answers with the server's current count; keep it on screen without refetching the lesson. */
  const setProgress = useCallback(
    (next: LessonProgressView) => {
      queryClient.setQueryData<LessonDetail>(keys.lesson(lesson.id), (old) => (old ? { ...old, progress: next } : old));
    },
    [queryClient, lesson.id]
  );

  const tracker = useLessonTracker({
    lessonId: lesson.id,
    enabled: !completed,
    isVideo,
    onProgress: (result) => setProgress(result.progress),
  });

  const complete = useMutation({
    mutationFn: () => {
      const position = tracker.currentPosition();
      return api.post<RecordResult>("/progress/lesson", { lessonId: lesson.id, completed: true, ...(position !== undefined ? { positionSeconds: position } : {}) });
    },
    onSuccess: (result) => {
      setProgress(result.progress);
      setFinished(result);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      void refreshAfterProgress(queryClient, { courseId: lesson.courseId, moduleId: lesson.moduleId, lessonId: lesson.id, certificate: result.newCertificate !== null });
    },
    // The server counts the time itself: when it says "not yet", show its latest count.
    onError: () => void queryClient.invalidateQueries({ queryKey: keys.lesson(lesson.id) }),
  });

  const moduleQuery = useQuery({ ...moduleOptions(lesson.moduleId), enabled: completed || finished !== null });
  const next = moduleQuery.data ? afterLesson(moduleQuery.data, lesson.id) : null;

  const title = pick(lang, lesson.title, lesson.titleHi);
  const text = pick(lang, lesson.content, lesson.contentHi);
  const image = resolveMediaUrl(lesson.imageUrl, API_BASE_URL);
  const stillNeeded = secondsStillNeeded(progress);
  const startAt = resumePosition(progress, lesson.videoDurationSeconds);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.badges}>
        <Badge label={t(`contentType.${lesson.contentType}`)} color={theme.text} tint={theme.surfaceAlt} />
        {completed ? <Badge label={t("lesson.completedBadge")} color={theme.success} tint={theme.successTint} /> : null}
      </View>
      <ThemedText type="h1" accessibilityRole="header">
        {title}
      </ThemedText>

      {!online && !completed ? <OfflineBanner /> : null}
      {!online && !completed ? <Banner tone="warning">{t("lesson.offlineNoCredit")}</Banner> : null}
      {tracker.previewOnly ? <Banner tone="warning">{t("lesson.previewOnly")}</Banner> : null}

      {isVideo ? <VideoPlayer lesson={lesson} startAt={startAt} onReport={tracker.report} /> : null}
      {lesson.contentType === "image" && image ? <Image source={{ uri: image }} accessibilityLabel={title} accessibilityIgnoresInvertColors resizeMode="contain" style={[styles.image, { backgroundColor: theme.surfaceAlt }]} /> : null}
      {lesson.contentType === "video" && !lesson.videoUrl ? <Banner tone="warning">{t("lesson.videoUnavailable")}</Banner> : null}

      {text ? <Markdown source={text} /> : null}

      {lesson.contentType === "quiz" ? <Button label={t("lesson.takeQuiz")} icon="edit-3" onPress={() => navigation.navigate("Quiz", { moduleId: lesson.moduleId })} /> : null}

      {!completed && !tracker.previewOnly ? (
        <Card style={{ gap: Spacing.md }}>
          <ThemedText type="h4">{t("lesson.timeTitle")}</ThemedText>
          <ProgressBar percent={watchPercent(progress)} label={t("lesson.timeTitle")} height={10} />
          <ThemedText muted accessibilityLiveRegion="polite">
            {progress.canComplete ? t("lesson.canFinish") : t("lesson.keepGoing", { wait: waitText(stillNeeded, t) })}
          </ThemedText>
          {complete.isError ? <Banner tone="error">{errorMessage(complete.error, t)}</Banner> : null}
          <Button label={complete.isPending ? t("lesson.saving") : t("lesson.markDone")} icon="check" onPress={() => complete.mutate()} loading={complete.isPending} disabled={!progress.canComplete} />
        </Card>
      ) : null}

      {completed ? (
        <Card style={{ gap: Spacing.md }}>
          <Banner tone="success" icon="check-circle">
            {t("lesson.completed")}
          </Banner>
          {finished?.newCertificate ? (
            <>
              <Banner tone="success" icon="award">
                {t("lesson.certificateEarned")}
              </Banner>
              {certActions.error ? <Banner tone="error">{errorMessage(certActions.error, t)}</Banner> : null}
              <Button label={t("profile.download")} icon="download" onPress={() => void certActions.download(finished.newCertificate?.id ?? "")} loading={certActions.busyId === finished.newCertificate.id} />
            </>
          ) : finished?.course?.completed ? (
            <Banner tone="success" icon="award">
              {t("lesson.courseCompleted")}
            </Banner>
          ) : null}
          {next?.kind === "lesson" ? <Button label={t("lesson.next")} icon="arrow-right" onPress={() => navigation.replace("LessonDetail", { lessonId: next.lessonId })} /> : null}
          {next?.kind === "quiz" ? <Button label={t("lesson.takeQuiz")} icon="edit-3" onPress={() => navigation.navigate("Quiz", { moduleId: next.moduleId })} /> : null}
          {next?.kind === "module" ? <Button label={t("lesson.backToModule")} variant="secondary" onPress={() => navigation.navigate("ModuleDetail", { moduleId: lesson.moduleId })} /> : null}
          {!next ? <Button label={t("lesson.backToCourse")} variant="secondary" onPress={() => navigation.navigate("CourseDetail", { courseId: lesson.courseId })} /> : null}
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing["3xl"] },
  badges: { flexDirection: "row", gap: Spacing.sm },
  image: { width: "100%", aspectRatio: 4 / 3, borderRadius: BorderRadius.md },
});
