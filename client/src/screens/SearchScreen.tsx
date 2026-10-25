import { useInfiniteQuery } from "@tanstack/react-query";
import React, { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { CourseCard } from "@/components/CourseCard";
import { ThemedText } from "@/components/ThemedText";
import { EmptyView, ErrorView, LoadingView, Screen, TextField } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { useDebounced } from "@/hooks/useDebounced";
import { useTheme } from "@/hooks/useTheme";
import { ApiError } from "@/lib/apiClient";
import { coursesOptions } from "@/lib/queries";
import { countText } from "@/lib/translate";
import { viewState } from "@/lib/viewState";
import { useAppNavigation } from "@/navigation/hooks";

const MIN_LETTERS = 2;
const OFFLINE = new ApiError(0, "NETWORK", "offline");

export default function SearchScreen() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const navigation = useAppNavigation();
  const [text, setText] = useState("");
  const q = useDebounced(text.trim(), 350);
  const enabled = q.length >= MIN_LETTERS;

  const results = useInfiniteQuery({ ...coursesOptions({ category: null, q }), enabled });
  const items = useMemo(() => results.data?.pages.flatMap((page) => page.items) ?? [], [results.data]);
  const total = results.data?.pages[0]?.total ?? 0;
  const state = viewState(results);
  const waiting = text.trim() !== q; // the learner is still typing

  return (
    <Screen edges={["bottom", "left", "right"]}>
      <FlatList
        data={enabled ? items : []}
        keyExtractor={(course) => course.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => <CourseCard course={item} onPress={() => navigation.navigate("CourseDetail", { courseId: item.id })} />}
        ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={{ gap: Spacing.md, marginBottom: Spacing.md }}>
            <TextField label={t("search.label")} value={text} onChangeText={setText} placeholder={t("search.placeholder")} autoFocus autoCorrect={false} returnKeyType="search" />
            {enabled && state === "ready" && !waiting ? (
              <ThemedText muted accessibilityLiveRegion="polite">
                {countText(t, "search.results", total)}
              </ThemedText>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !enabled ? (
            <EmptyView icon="search" title={t("search.hintTitle")} body={t("search.hint", { n: MIN_LETTERS })} />
          ) : waiting || state === "loading" ? (
            <LoadingView />
          ) : state === "offline" ? (
            <ErrorView error={OFFLINE} />
          ) : state === "error" ? (
            <ErrorView error={results.error} onRetry={() => void results.refetch()} />
          ) : (
            <EmptyView icon="search" title={t("search.noResults")} body={t("search.noResultsBody", { query: q })} />
          )
        }
        ListFooterComponent={results.isFetchingNextPage ? <ActivityIndicator color={theme.primaryText} style={{ margin: Spacing.lg }} /> : null}
        onEndReached={() => {
          if (enabled && results.hasNextPage && !results.isFetchingNextPage) void results.fetchNextPage();
        }}
        onEndReachedThreshold={0.5}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.lg, paddingBottom: Spacing["3xl"] },
});
