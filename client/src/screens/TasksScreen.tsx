import { useQuery } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather"; // this icon set only: importing the package root would bundle every font (about 4 MB)
import React, { useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { ThemedText } from "@/components/ThemedText";
import { EmptyView, ErrorView, LoadingView, OfflineBanner, ProgressBar, Screen, Segmented } from "@/components/ui";
import { BorderRadius, MIN_TOUCH, Spacing } from "@/constants/theme";
import { useLang } from "@/hooks/useLang";
import { useOnline } from "@/hooks/useOnline";
import { useTheme } from "@/hooks/useTheme";
import { ApiError } from "@/lib/apiClient";
import { pick } from "@/lib/format";
import { enrolledOptions } from "@/lib/queries";
import { viewState } from "@/lib/viewState";
import { useAppNavigation } from "@/navigation/hooks";
import type { ContentType, EnrolledCourse, TaskLesson } from "@/types";

type Filter = "all" | "todo" | "done";
interface Row {
  lesson: TaskLesson;
  moduleTitle: string;
}
interface Section {
  course: EnrolledCourse;
  data: Row[];
  done: number;
  total: number;
}

const TYPE_ICON: Record<ContentType, keyof typeof Feather.glyphMap> = { video: "play-circle", text: "file-text", image: "image", quiz: "help-circle" };
const OFFLINE = new ApiError(0, "NETWORK", "offline");

export default function TasksScreen() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const lang = useLang();
  const online = useOnline();
  const navigation = useAppNavigation();
  const [filter, setFilter] = useState<Filter>("all");
  const enrolled = useQuery(enrolledOptions());
  const state = viewState(enrolled);

  const { sections, done, total } = useMemo(() => {
    let doneCount = 0;
    let totalCount = 0;
    const out: Section[] = [];
    for (const course of enrolled.data ?? []) {
      const rows: Row[] = course.modules.flatMap((m) => m.lessons.map((lesson) => ({ lesson, moduleTitle: pick(lang, m.title, m.titleHi) })));
      const finished = rows.filter((r) => r.lesson.completed).length;
      doneCount += finished;
      totalCount += rows.length;
      const visible = filter === "all" ? rows : rows.filter((r) => (filter === "done") === r.lesson.completed);
      if (visible.length > 0) out.push({ course, data: visible, done: finished, total: rows.length });
    }
    return { sections: out, done: doneCount, total: totalCount };
  }, [enrolled.data, filter, lang]);

  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  const header = (
    <View style={styles.header}>
      <ThemedText type="h2" accessibilityRole="header">
        {t("tasks.title")}
      </ThemedText>
      {state === "ready" && total > 0 ? (
        <>
          <ThemedText muted>{t("tasks.summary", { done, total })}</ThemedText>
          <ProgressBar percent={percent} label={t("tasks.summary", { done, total })} />
          <Segmented
            label={t("tasks.filter")}
            value={filter}
            onChange={setFilter}
            options={[
              { value: "all", label: t("tasks.filterAll") },
              { value: "todo", label: t("tasks.filterTodo") },
              { value: "done", label: t("tasks.filterDone") },
            ]}
          />
        </>
      ) : null}
      {!online ? <OfflineBanner /> : null}
    </View>
  );

  const empty =
    state === "loading" ? (
      <LoadingView />
    ) : state === "offline" ? (
      <ErrorView error={OFFLINE} onRetry={() => void enrolled.refetch()} />
    ) : state === "error" ? (
      <ErrorView error={enrolled.error} onRetry={() => void enrolled.refetch()} />
    ) : total === 0 ? (
      <EmptyView icon="check-square" title={t("tasks.emptyTitle")} body={t("tasks.emptyBody")} actionLabel={t("tasks.browse")} onAction={() => navigation.navigate("Tabs", { screen: "Learn" })} />
    ) : filter === "done" ? (
      <EmptyView icon="clock" title={t("tasks.noneDoneTitle")} body={t("tasks.noneDoneBody")} />
    ) : (
      <EmptyView icon="award" title={t("tasks.allDoneTitle")} body={t("tasks.allDoneBody")} />
    );

  return (
    <Screen edges={["top", "left", "right"]}>
      <SectionList
        sections={sections}
        keyExtractor={(row) => row.lesson.id}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={enrolled.isRefetching} onRefresh={() => void enrolled.refetch()} tintColor={theme.primaryText} colors={[theme.primaryText]} />}
        renderSectionHeader={({ section }) => (
          <Pressable onPress={() => navigation.navigate("CourseDetail", { courseId: section.course.id })} accessibilityRole="button" accessibilityLabel={`${pick(lang, section.course.title, section.course.titleHi)}. ${t("tasks.summary", { done: section.done, total: section.total })}`} style={styles.sectionHeader}>
            <View style={{ flex: 1 }}>
              <ThemedText type="h4" numberOfLines={2}>
                {pick(lang, section.course.title, section.course.titleHi)}
              </ThemedText>
              <ThemedText type="small" muted>
                {t("tasks.summary", { done: section.done, total: section.total })}
              </ThemedText>
            </View>
            <Feather name="chevron-right" size={20} color={theme.textSecondary} />
          </Pressable>
        )}
        renderItem={({ item }) => {
          const finished = item.lesson.completed;
          const title = pick(lang, item.lesson.title, item.lesson.titleHi);
          return (
            <Pressable
              onPress={() => navigation.navigate("LessonDetail", { lessonId: item.lesson.id })}
              accessibilityRole="button"
              accessibilityLabel={`${title}. ${finished ? t("tasks.statusDone") : t("tasks.statusTodo")}`}
              accessibilityHint={t("tasks.openLesson")}
              style={({ pressed }) => [styles.row, { backgroundColor: theme.surface, borderColor: finished ? theme.success : theme.border }, pressed && { opacity: 0.85 }]}
            >
              <Feather name={finished ? "check-circle" : "circle"} size={26} color={finished ? theme.success : theme.controlBorder} />
              <View style={{ flex: 1, gap: 2 }}>
                <ThemedText style={{ fontWeight: "600" }} numberOfLines={2}>
                  {title}
                </ThemedText>
                <ThemedText type="small" muted numberOfLines={1}>
                  {item.moduleTitle} · {t(`contentType.${item.lesson.contentType}`)}
                </ThemedText>
              </View>
              <Feather name={TYPE_ICON[item.lesson.contentType]} size={20} color={theme.textSecondary} />
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.lg, paddingBottom: Spacing["3xl"] },
  header: { gap: Spacing.md, marginBottom: Spacing.md },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: Spacing.md, minHeight: MIN_TOUCH, marginTop: Spacing.lg, marginBottom: Spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.md, minHeight: MIN_TOUCH + 12, padding: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1.5, marginBottom: Spacing.sm },
});
