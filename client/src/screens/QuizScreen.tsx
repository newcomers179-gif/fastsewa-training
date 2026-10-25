import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather"; // this icon set only: importing the package root would bundle every font (about 4 MB)
import * as Haptics from "expo-haptics";
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { QueryGate } from "@/components/QueryGate";
import { ThemedText } from "@/components/ThemedText";
import { Banner, Button, Card, EmptyView, ProgressBar, Screen } from "@/components/ui";
import { BorderRadius, MIN_TOUCH, Spacing } from "@/constants/theme";
import { useCertificateActions } from "@/hooks/useCertificateActions";
import { useLang } from "@/hooks/useLang";
import { useTheme } from "@/hooks/useTheme";
import { api } from "@/lib/api";
import { confirmAction } from "@/lib/confirm";
import { errorMessage, waitText } from "@/lib/errors";
import { pick } from "@/lib/format";
import { quizOptions, refreshAfterProgress } from "@/lib/queries";
import { countText } from "@/lib/translate";
import { useAppNavigation, type ScreenProps } from "@/navigation/hooks";
import type { Lang, QuizData, QuizQuestion, QuizResult } from "@/types";

export default function QuizScreen({ route }: ScreenProps<"Quiz">) {
  const query = useQuery(quizOptions(route.params.moduleId));
  return (
    <Screen edges={["bottom", "left", "right"]}>
      <QueryGate query={query}>{(data) => <QuizBody data={data} moduleId={route.params.moduleId} />}</QueryGate>
    </Screen>
  );
}

/** Hindi options are used only when they exist and match the English ones one for one. */
function optionsFor(question: QuizQuestion, lang: Lang): string[] {
  return lang === "hi" && question.optionsHi && question.optionsHi.length === question.options.length ? question.optionsHi : question.options;
}

function QuizBody({ data, moduleId }: { data: QuizData; moduleId: string }) {
  const { t } = useTranslation();
  const lang = useLang();
  const navigation = useAppNavigation();
  const queryClient = useQueryClient();
  const certActions = useCertificateActions();
  const total = data.questions.length;
  const [answers, setAnswers] = useState<(number | null)[]>(() => data.questions.map(() => null));
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<QuizResult | null>(null);

  const answered = answers.filter((a) => a !== null).length;
  const dirty = result === null && answered > 0;
  const secondsUntilNext = data.status.nextAttemptAt ? (new Date(data.status.nextAttemptAt).getTime() - Date.now()) / 1000 : 0;

  // Leaving half-way loses the answers: ask first.
  useEffect(() => {
    return navigation.addListener("beforeRemove", (event) => {
      if (!dirty) return;
      event.preventDefault();
      void confirmAction({ title: t("quiz.leaveTitle"), message: t("quiz.leaveBody"), confirmLabel: t("quiz.leave"), cancelLabel: t("quiz.stay"), destructive: true }).then((leave) => {
        if (leave) navigation.dispatch(event.data.action);
      });
    });
  }, [navigation, dirty, t]);

  const submit = useMutation({
    mutationFn: () => api.post<QuizResult>(`/quiz/${data.quiz.id}/submit`, { answers: answers.map((a) => a ?? 0) }),
    onSuccess: (outcome) => {
      setResult(outcome);
      void Haptics.notificationAsync(outcome.passed ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
      void refreshAfterProgress(queryClient, { moduleId, certificate: outcome.newCertificate !== null });
    },
  });

  if (total === 0) return <EmptyView icon="help-circle" title={t("quiz.noQuestions")} />;

  if (data.status.nextAttemptAt && secondsUntilNext > 0 && result === null) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        <Banner tone="warning" icon="clock">
          {t("module.attemptsUsed", { wait: waitText(secondsUntilNext, t) })}
        </Banner>
        <Button label={t("lesson.backToModule")} variant="secondary" onPress={() => navigation.goBack()} />
      </ScrollView>
    );
  }

  if (result) {
    return (
      <ResultView
        data={data}
        result={result}
        lang={lang}
        onRetry={() => {
          setAnswers(data.questions.map(() => null));
          setIndex(0);
          setResult(null);
          submit.reset();
        }}
        onDone={() => navigation.goBack()}
        onCertificate={(id) => void certActions.download(id)}
        certificateBusy={certActions.busyId}
        certificateError={certActions.error}
      />
    );
  }

  const question = data.questions[index];
  const options = optionsFor(question, lang);
  const unanswered = total - answered;
  const last = index === total - 1;
  const firstUnanswered = answers.findIndex((a) => a === null);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={{ gap: Spacing.xs }}>
        <ThemedText type="small" muted accessibilityLiveRegion="polite">
          {t("quiz.question", { current: index + 1, total })} · {t("quiz.answered", { n: answered, total })}
        </ThemedText>
        <ProgressBar percent={(answered / total) * 100} label={t("quiz.answered", { n: answered, total })} />
      </View>

      <ThemedText type="h3" accessibilityRole="header">
        {pick(lang, question.question, question.questionHi)}
      </ThemedText>

      <View accessibilityRole="radiogroup" style={{ gap: Spacing.sm }}>
        {options.map((option, optionIndex) => (
          <OptionRow
            key={optionIndex}
            label={option}
            selected={answers[index] === optionIndex}
            onPress={() => setAnswers((current) => current.map((a, i) => (i === index ? optionIndex : a)))}
          />
        ))}
      </View>

      {submit.isError ? <Banner tone="error">{errorMessage(submit.error, t)}</Banner> : null}

      <View style={styles.nav}>
        <Button label={t("quiz.previous")} variant="secondary" icon="arrow-left" onPress={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} style={{ flex: 1 }} />
        {last ? (
          <Button label={t("quiz.submit")} icon="check" onPress={() => submit.mutate()} loading={submit.isPending} disabled={unanswered > 0} style={{ flex: 1 }} />
        ) : (
          <Button label={t("quiz.next")} icon="arrow-right" onPress={() => setIndex((i) => Math.min(total - 1, i + 1))} style={{ flex: 1 }} />
        )}
      </View>
      {last && unanswered > 0 ? (
        <Banner tone="info">
          <ThemedText>{countText(t, "quiz.unanswered", unanswered)}</ThemedText>
          <Button label={t("quiz.goToUnanswered")} variant="ghost" onPress={() => setIndex(Math.max(0, firstUnanswered))} compact />
        </Banner>
      ) : null}
    </ScrollView>
  );
}

function OptionRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.option, { borderColor: selected ? theme.primary : theme.controlBorder, backgroundColor: selected ? theme.primaryTint : theme.surface }, pressed && { opacity: 0.85 }]}
    >
      <View style={[styles.radio, { borderColor: selected ? theme.primary : theme.controlBorder, backgroundColor: selected ? theme.primary : "transparent" }]}>{selected ? <Feather name="check" size={16} color={theme.onPrimary} /> : null}</View>
      <ThemedText style={{ flex: 1 }}>{label}</ThemedText>
    </Pressable>
  );
}

function ResultView({
  data,
  result,
  lang,
  onRetry,
  onDone,
  onCertificate,
  certificateBusy,
  certificateError,
}: {
  data: QuizData;
  result: QuizResult;
  lang: Lang;
  onRetry: () => void;
  onDone: () => void;
  onCertificate: (id: string) => void;
  certificateBusy: string | null;
  certificateError: unknown;
}) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const byQuestion = useMemo(() => new Map(result.feedback.map((f) => [f.questionId, f])), [result.feedback]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Card style={{ alignItems: "center", gap: Spacing.sm }}>
        <Feather name={result.passed ? "award" : "alert-circle"} size={48} color={result.passed ? theme.success : theme.warning} />
        <ThemedText type="h1" accessibilityRole="header">
          {result.passed ? t("quiz.result.passedTitle") : t("quiz.result.failedTitle")}
        </ThemedText>
        <ThemedText type="h2">{t("quiz.result.score", { score: result.score })}</ThemedText>
        <ThemedText muted>
          {t("quiz.result.correct", { correct: result.correctCount, total: result.totalQuestions })} · {t("quiz.result.passMark", { score: result.passingScore })}
        </ThemedText>
      </Card>

      {result.newCertificate ? (
        <Card style={{ gap: Spacing.md }}>
          <Banner tone="success" icon="award">
            {t("lesson.certificateEarned")}
          </Banner>
          {certificateError ? <Banner tone="error">{errorMessage(certificateError, t)}</Banner> : null}
          <Button label={t("profile.download")} icon="download" onPress={() => onCertificate(result.newCertificate?.id ?? "")} loading={certificateBusy === result.newCertificate.id} />
        </Card>
      ) : result.passed && result.course?.completed ? (
        <Banner tone="success" icon="award">
          {t("lesson.courseCompleted")}
        </Banner>
      ) : null}

      {!result.passed ? (
        <>
          <Banner tone="info">{t("quiz.result.hideAnswers")}</Banner>
          {result.attemptsRemaining > 0 ? <ThemedText muted>{countText(t, "module.attemptsLeft", result.attemptsRemaining)}</ThemedText> : <Banner tone="warning" icon="clock">{t("quiz.result.noAttempts")}</Banner>}
        </>
      ) : null}

      <ThemedText type="h3" accessibilityRole="header">
        {t("quiz.result.reviewTitle")}
      </ThemedText>
      {data.questions.map((question, i) => {
        const feedback = byQuestion.get(question.id);
        const options = optionsFor(question, lang);
        const right = feedback?.isCorrect === true;
        const explanation = feedback ? pick(lang, feedback.explanation, feedback.explanationHi) : "";
        return (
          <Card key={question.id} style={{ gap: Spacing.xs, borderColor: right ? theme.success : theme.error }}>
            <View style={styles.resultHead}>
              <Feather name={right ? "check-circle" : "x-circle"} size={22} color={right ? theme.success : theme.error} />
              <ThemedText style={{ flex: 1, fontWeight: "700" }}>
                {i + 1}. {pick(lang, question.question, question.questionHi)}
              </ThemedText>
            </View>
            <ThemedText type="small">
              {t("quiz.result.yourAnswer")}: {feedback ? options[feedback.yourAnswer] : ""} — {right ? t("quiz.result.right") : t("quiz.result.wrong")}
            </ThemedText>
            {result.passed && feedback?.correctAnswer !== undefined && !right ? (
              <ThemedText type="small" style={{ color: theme.success, fontWeight: "600" }}>
                {t("quiz.result.correctAnswer")}: {options[feedback.correctAnswer]}
              </ThemedText>
            ) : null}
            {result.passed && explanation ? (
              <ThemedText type="small" muted>
                {t("quiz.result.explanation")}: {explanation}
              </ThemedText>
            ) : null}
          </Card>
        );
      })}

      <View style={{ gap: Spacing.sm }}>
        {!result.passed && result.attemptsRemaining > 0 ? <Button label={t("quiz.result.tryAgain")} icon="refresh-cw" onPress={onRetry} /> : null}
        <Button label={result.passed ? t("quiz.result.continue") : t("lesson.backToModule")} variant={result.passed ? "primary" : "secondary"} onPress={onDone} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing["3xl"] },
  option: { flexDirection: "row", alignItems: "center", gap: Spacing.md, minHeight: MIN_TOUCH + 8, padding: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 2 },
  radio: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  nav: { flexDirection: "row", gap: Spacing.md },
  resultHead: { flexDirection: "row", gap: Spacing.sm, alignItems: "flex-start" },
});
