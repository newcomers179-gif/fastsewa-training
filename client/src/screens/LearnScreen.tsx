import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { CATEGORIES } from "@shared/constants";
import { CourseCard } from "@/components/CourseCard";
import { ThemedText } from "@/components/ThemedText";
import { Card, Chip, EmptyView, ErrorView, IconButton, LoadingView, OfflineBanner, ProgressBar, Screen, categoryIcon } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useUser } from "@/hooks/useAuth";
import { useLang } from "@/hooks/useLang";
import { useOnline } from "@/hooks/useOnline";
import { useTheme } from "@/hooks/useTheme";
import { ApiError } from "@/lib/apiClient";
import { firstName, pick } from "@/lib/format";
import { coursesOptions, enrolledOptions } from "@/lib/queries";
import { viewState } from "@/lib/viewState";
import { useAppNavigation } from "@/navigation/hooks";
import type { Category } from "@/types";

const OFFLINE = new ApiError(0, "NETWORK", "offline");

export default function LearnScreen() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const user = useUser();
  const lang = useLang();
  const online = useOnline();
  const navigation = useAppNavigation();
  const [category, setCategory] = useState<Category | null>(null);

  const courses = useInfiniteQuery(coursesOptions({ category, q: "" }));
  const enrolled = useQuery(enrolledOptions());
  const items = useMemo(() => courses.data?.pages.flatMap((page) => page.items) ?? [], [courses.data]);
  const resume = enrolled.data?.find((c) => c.completedAt === null && c.completionPercent < 100);
  const state = viewState(courses);

  const header = (
    <View style={styles.header}>
      <View style={styles.greetingRow}>
        <View style={{ flex: 1 }}>
          <ThemedText type="h2" accessibilityRole="header" numberOfLines={1}>
            {t("learn.hello", { name: firstName(user.displayName) })}
          </ThemedText>
          <ThemedText muted>{t("learn.subtitle")}</ThemedText>
        </View>
        <IconButton icon="search" label={t("learn.search")} onPress={() => navigation.navigate("Search")} />
      </View>

      {!online ? <OfflineBanner /> : null}

      {resume ? (
        <Card onPress={() => navigation.navigate("CourseDetail", { courseId: resume.id })} accessibilityLabel={`${t("learn.continue")}: ${pick(lang, resume.title, resume.titleHi)}`} style={{ gap: Spacing.sm, backgroundColor: theme.primaryTint }}>
          <ThemedText type="small" style={{ fontWeight: "700", color: theme.primaryText }}>
            {t("learn.continue")}
          </ThemedText>
          <ThemedText type="h4" numberOfLines={2}>
            {pick(lang, resume.title, resume.titleHi)}
          </ThemedText>
          <ProgressBar percent={resume.completionPercent} label={t("common.percentDone", { percent: resume.completionPercent })} />
        </Card>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist">
        <Chip label={t("learn.allTopics")} selected={category === null} onPress={() => setCategory(null)} icon="grid" />
        {CATEGORIES.map((c) => (
          <Chip key={c} label={t(`categories.${c}`)} selected={category === c} onPress={() => setCategory(c)} icon={categoryIcon(c)} />
        ))}
      </ScrollView>
    </View>
  );

  return (
    <Screen edges={["top", "left", "right"]}>
      <FlatList
        data={items}
        keyExtractor={(course) => course.id}
        renderItem={({ item }) => <CourseCard course={item} onPress={() => navigation.navigate("CourseDetail", { courseId: item.id })} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          state === "loading" ? (
            <LoadingView />
          ) : state === "offline" ? (
            <ErrorView error={OFFLINE} onRetry={() => void courses.refetch()} />
          ) : state === "error" ? (
            <ErrorView error={courses.error} onRetry={() => void courses.refetch()} />
          ) : (
            <EmptyView icon="book" title={category ? t("learn.emptyTopic") : t("learn.empty")} body={t("learn.emptyBody")} />
          )
        }
        ListFooterComponent={courses.isFetchingNextPage ? <ActivityIndicator color={theme.primaryText} style={{ margin: Spacing.lg }} /> : null}
        onEndReached={() => {
          if (courses.hasNextPage && !courses.isFetchingNextPage) void courses.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
        refreshControl={
          <RefreshControl
            refreshing={courses.isRefetching && !courses.isFetchingNextPage}
            onRefresh={() => {
              void courses.refetch();
              void enrolled.refetch();
            }}
            tintColor={theme.primaryText}
            colors={[theme.primaryText]}
          />
        }
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.lg, paddingBottom: Spacing["3xl"] },
  header: { gap: Spacing.lg, marginBottom: Spacing.lg },
  greetingRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md },
  chips: { gap: Spacing.sm, paddingVertical: Spacing.xs },
});
