import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather"; // this icon set only: importing the package root would bundle every font (about 4 MB)
import React from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { QueryGate } from "@/components/QueryGate";
import { ThemedText } from "@/components/ThemedText";
import { Badge, Banner, Button, Card, ProgressBar, Screen, categoryIcon } from "@/components/ui";
import { BorderRadius, CATEGORY_COLOR, MIN_TOUCH, Spacing } from "@/constants/theme";
import { useCertificateActions } from "@/hooks/useCertificateActions";
import { useUser } from "@/hooks/useAuth";
import { useLang } from "@/hooks/useLang";
import { useTheme } from "@/hooks/useTheme";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { pick } from "@/lib/format";
import { lessonsDoneIn, nextStep } from "@/lib/learning";
import { certificatesOptions, courseOptions, refreshAfterProgress } from "@/lib/queries";
import { countText } from "@/lib/translate";
import { useAppNavigation, type ScreenProps } from "@/navigation/hooks";
import type { CourseOutline } from "@/types";

export default function CourseDetailScreen({ route }: ScreenProps<"CourseDetail">) {
  const query = useQuery(courseOptions(route.params.courseId));
  return (
    <Screen edges={["bottom", "left", "right"]}>
      <QueryGate query={query}>{(course) => <CourseBody course={course} refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}</QueryGate>
    </Screen>
  );
}

function CourseBody({ course, refreshing, onRefresh }: { course: CourseOutline; refreshing: boolean; onRefresh: () => void }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const lang = useLang();
  const user = useUser();
  const navigation = useAppNavigation();
  const queryClient = useQueryClient();
  const certActions = useCertificateActions();

  const enrolled = course.enrollment !== null;
  const completed = course.enrollment?.completedAt != null;
  const canOpenModules = enrolled || user.role !== "worker";
  const certificates = useQuery({ ...certificatesOptions(), enabled: completed });
  const certificate = certificates.data?.find((c) => c.courseId === course.id && !c.revoked);

  const enroll = useMutation({
    mutationFn: () => api.post(`/courses/${course.id}/enroll`),
    onSuccess: () => refreshAfterProgress(queryClient, { courseId: course.id }),
  });

  const step = enrolled ? nextStep(course) : null;
  const started = course.modules.some((m) => m.lessons.some((l) => l.completed));
  const accent = CATEGORY_COLOR[course.category] ?? theme.brand;

  const goNext = () => {
    if (step?.kind === "lesson") navigation.navigate("LessonDetail", { lessonId: step.lessonId });
    else if (step?.kind === "quiz") navigation.navigate("Quiz", { moduleId: step.moduleId });
  };

  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryText} colors={[theme.primaryText]} />}>
      <View style={styles.badges}>
        <Feather name={categoryIcon(course.category)} size={20} color={accent} />
        <Badge label={t(`categories.${course.category}`)} color={theme.text} tint={theme.surfaceAlt} />
        <Badge label={t(`difficulty.${course.difficulty}`)} color={theme.text} tint={theme.surfaceAlt} />
      </View>
      <ThemedText type="h1" accessibilityRole="header">
        {pick(lang, course.title, course.titleHi)}
      </ThemedText>
      <ThemedText muted>
        {[countText(t, "common.modules", course.modules.length), countText(t, "common.lessons", course.modules.reduce((n, m) => n + m.lessons.length, 0)), ...(course.durationMinutes > 0 ? [countText(t, "common.minutes", course.durationMinutes)] : [])].join(" · ")}
      </ThemedText>

      {course.preview ? <Banner tone="warning">{t("course.preview")}</Banner> : null}

      <ThemedText type="reading">{pick(lang, course.description, course.descriptionHi)}</ThemedText>

      {!enrolled && !course.preview ? (
        <>
          {enroll.isError ? <Banner tone="error">{errorMessage(enroll.error, t)}</Banner> : null}
          <Button label={enroll.isPending ? t("course.enrolling") : t("course.enroll")} icon="plus-circle" onPress={() => enroll.mutate()} loading={enroll.isPending} />
        </>
      ) : null}

      {enrolled ? (
        <Card style={{ gap: Spacing.md }}>
          <ThemedText type="h4">{t("course.progress")}</ThemedText>
          <ProgressBar percent={course.enrollment?.completionPercent ?? 0} label={t("common.percentDone", { percent: course.enrollment?.completionPercent ?? 0 })} height={10} />
          <ThemedText type="small" muted>
            {t("common.percentDone", { percent: course.enrollment?.completionPercent ?? 0 })}
          </ThemedText>
          {completed ? (
            <>
              <Banner tone="success" icon="award">
                {t("course.completed")}
              </Banner>
              {certActions.error ? <Banner tone="error">{errorMessage(certActions.error, t)}</Banner> : null}
              {certificate ? <Button label={t("profile.download")} icon="download" onPress={() => void certActions.download(certificate.id)} loading={certActions.busyId === certificate.id} /> : null}
            </>
          ) : step && step.kind !== "done" ? (
            <Button label={started ? t("course.continue") : t("course.start")} icon="play" onPress={goNext} />
          ) : null}
        </Card>
      ) : null}

      <ThemedText type="h3" accessibilityRole="header" style={{ marginTop: Spacing.sm }}>
        {t("course.modules")}
      </ThemedText>
      {course.modules.length === 0 ? <ThemedText muted>{t("course.noModules")}</ThemedText> : null}
      {course.modules.map((module, index) => {
        const { done, total } = lessonsDoneIn(module);
        const title = pick(lang, module.title, module.titleHi);
        return (
          <Card
            key={module.id}
            onPress={canOpenModules ? () => navigation.navigate("ModuleDetail", { moduleId: module.id }) : undefined}
            accessibilityLabel={`${index + 1}. ${title}. ${t("course.lessonsProgress", { done, total })}${module.completed ? `. ${t("course.moduleDone")}` : ""}`}
            style={{ gap: Spacing.sm }}
          >
            <View style={styles.moduleRow}>
              <View style={[styles.number, { backgroundColor: module.completed ? theme.success : theme.surfaceAlt }]}>
                {module.completed ? <Feather name="check" size={18} color={theme.surface} /> : <ThemedText style={{ fontWeight: "700" }}>{index + 1}</ThemedText>}
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText type="h4" numberOfLines={2}>
                  {title}
                </ThemedText>
                <ThemedText type="small" muted>
                  {t("course.lessonsProgress", { done, total })}
                  {module.hasQuiz ? ` · ${module.quizPassed ? t("course.quizPassed") : t("course.quizBadge")}` : ""}
                </ThemedText>
              </View>
              {canOpenModules ? <Feather name="chevron-right" size={20} color={theme.textSecondary} /> : null}
            </View>
            {!canOpenModules ? (
              <View style={{ gap: 2 }}>
                {module.lessons.map((lesson) => (
                  <ThemedText key={lesson.id} type="small" muted>
                    • {pick(lang, lesson.title, lesson.titleHi)}
                  </ThemedText>
                ))}
              </View>
            ) : null}
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing["3xl"] },
  badges: { flexDirection: "row", alignItems: "center", gap: Spacing.sm },
  moduleRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, minHeight: MIN_TOUCH },
  number: { width: 36, height: 36, borderRadius: BorderRadius.full, alignItems: "center", justifyContent: "center" },
});
