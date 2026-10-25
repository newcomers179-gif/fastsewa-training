import { useQuery } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather"; // this icon set only: importing the package root would bundle every font (about 4 MB)
import React from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { QueryGate } from "@/components/QueryGate";
import { ThemedText } from "@/components/ThemedText";
import { Badge, Banner, Button, Card, ProgressBar, Screen } from "@/components/ui";
import { BorderRadius, MIN_TOUCH, Spacing } from "@/constants/theme";
import { useLang } from "@/hooks/useLang";
import { useTheme } from "@/hooks/useTheme";
import { waitText } from "@/lib/errors";
import { formatClock, pick } from "@/lib/format";
import { moduleOptions } from "@/lib/queries";
import { countText } from "@/lib/translate";
import { useAppNavigation, type ScreenProps } from "@/navigation/hooks";
import type { ContentType, ModuleDetail } from "@/types";

const TYPE_ICON: Record<ContentType, keyof typeof Feather.glyphMap> = { video: "play-circle", text: "file-text", image: "image", quiz: "help-circle" };

export default function ModuleDetailScreen({ route }: ScreenProps<"ModuleDetail">) {
  const query = useQuery(moduleOptions(route.params.moduleId));
  return (
    <Screen edges={["bottom", "left", "right"]}>
      <QueryGate query={query}>{(module) => <ModuleBody module={module} refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}</QueryGate>
    </Screen>
  );
}

function ModuleBody({ module, refreshing, onRefresh }: { module: ModuleDetail; refreshing: boolean; onRefresh: () => void }) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const lang = useLang();
  const navigation = useAppNavigation();
  const { quiz, progress } = module;
  const description = pick(lang, module.description, module.descriptionHi);
  const required = progress?.requiredLessons ?? 0;
  const requiredDone = progress?.requiredDone ?? 0;

  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.primaryText} colors={[theme.primaryText]} />}>
      <ThemedText type="h1" accessibilityRole="header">
        {pick(lang, module.title, module.titleHi)}
      </ThemedText>
      {description ? <ThemedText type="reading">{description}</ThemedText> : null}
      {progress && required > 0 ? (
        <View style={{ gap: Spacing.xs }}>
          <ProgressBar percent={(requiredDone / required) * 100} label={t("module.requiredProgress", { done: requiredDone, total: required })} />
          <ThemedText type="small" muted>
            {t("module.requiredProgress", { done: requiredDone, total: required })}
          </ThemedText>
        </View>
      ) : null}

      <ThemedText type="h3" accessibilityRole="header">
        {t("module.lessons")}
      </ThemedText>
      {module.lessons.length === 0 ? <ThemedText muted>{t("module.noLessons")}</ThemedText> : null}
      {module.lessons.map((lesson) => {
        const title = pick(lang, lesson.title, lesson.titleHi);
        const detail = [t(`contentType.${lesson.contentType}`), ...(lesson.videoDurationSeconds ? [formatClock(lesson.videoDurationSeconds)] : [])].join(" · ");
        return (
          <Pressable
            key={lesson.id}
            onPress={() => navigation.navigate("LessonDetail", { lessonId: lesson.id })}
            accessibilityRole="button"
            accessibilityLabel={`${title}. ${detail}. ${lesson.completed ? t("tasks.statusDone") : t("tasks.statusTodo")}${lesson.isRequired ? "" : `. ${t("module.optional")}`}`}
            style={({ pressed }) => [styles.lessonRow, { backgroundColor: theme.surface, borderColor: lesson.completed ? theme.success : theme.border }, pressed && { opacity: 0.85 }]}
          >
            <Feather name={lesson.completed ? "check-circle" : "circle"} size={26} color={lesson.completed ? theme.success : theme.controlBorder} />
            <View style={{ flex: 1, gap: 2 }}>
              <ThemedText style={{ fontWeight: "600" }} numberOfLines={2}>
                {title}
              </ThemedText>
              <ThemedText type="small" muted>
                {detail}
              </ThemedText>
            </View>
            {!lesson.isRequired ? <Badge label={t("module.optional")} color={theme.text} tint={theme.surfaceAlt} /> : null}
            <Feather name={TYPE_ICON[lesson.contentType]} size={20} color={theme.textSecondary} />
          </Pressable>
        );
      })}

      {quiz ? <QuizCard moduleId={module.id} quiz={quiz} /> : null}
    </ScrollView>
  );
}

function QuizCard({ moduleId, quiz }: { moduleId: string; quiz: NonNullable<ModuleDetail["quiz"]> }) {
  const { t } = useTranslation();
  const navigation = useAppNavigation();
  const secondsUntilNext = quiz.nextAttemptAt ? Math.max(1, (new Date(quiz.nextAttemptAt).getTime() - Date.now()) / 1000) : 0;
  const exhausted = quiz.nextAttemptAt !== null && secondsUntilNext > 0;
  const attemptsLeft = Math.max(0, quiz.maxAttempts - quiz.attemptsToday);
  const open = () => navigation.navigate("Quiz", { moduleId });

  return (
    <Card style={{ gap: Spacing.md, marginTop: Spacing.sm }}>
      <ThemedText type="h3" accessibilityRole="header">
        {t("module.quiz")}
      </ThemedText>
      {quiz.passed ? <Banner tone="success" icon="award">{t("module.quizPassed", { score: quiz.bestScore ?? 0 })}</Banner> : null}
      {quiz.locked ? (
        <Banner tone="info" icon="lock">
          {t("module.quizLocked")}
        </Banner>
      ) : exhausted ? (
        <Banner tone="warning" icon="clock">
          {t("module.attemptsUsed", { wait: waitText(secondsUntilNext, t) })}
        </Banner>
      ) : (
        <ThemedText muted>
          {t("module.quizReady", { score: quiz.passingScore })} {countText(t, "module.attemptsLeft", attemptsLeft)}
        </ThemedText>
      )}
      <Button label={quiz.passed ? t("module.quizRetake") : t("module.quizStart")} icon="edit-3" variant={quiz.passed ? "secondary" : "primary"} onPress={open} disabled={quiz.locked || exhausted} />
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing["3xl"] },
  lessonRow: { flexDirection: "row", alignItems: "center", gap: Spacing.md, minHeight: MIN_TOUCH + 12, padding: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1.5 },
});
