import React, { useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import Feather from "@expo/vector-icons/Feather"; // this icon set only: importing the package root would bundle every font (about 4 MB)
import { useTranslation } from "react-i18next";
import { Badge, Card, ProgressBar, categoryIcon } from "@/components/ui";
import { ThemedText } from "@/components/ThemedText";
import { BorderRadius, CATEGORY_COLOR, Spacing } from "@/constants/theme";
import { useLang } from "@/hooks/useLang";
import { useTheme } from "@/hooks/useTheme";
import { pick } from "@/lib/format";
import { API_BASE_URL } from "@/lib/config";
import { resolveMediaUrl } from "@/lib/media";
import { countText } from "@/lib/translate";
import type { CourseListItem } from "@/types";

const THUMB = 84;

export function CourseCard({ course, onPress }: { course: CourseListItem; onPress: () => void }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const lang = useLang();
  const [thumbFailed, setThumbFailed] = useState(false);

  const title = pick(lang, course.title, course.titleHi);
  const accent = CATEGORY_COLOR[course.category] ?? theme.brand;
  const thumb = thumbFailed ? null : resolveMediaUrl(course.thumbnailUrl, API_BASE_URL);
  const completed = course.completedAt !== null;
  const meta = [
    countText(t, "common.lessons", course.lessonCount),
    ...(course.durationMinutes > 0 ? [countText(t, "common.minutes", course.durationMinutes)] : []),
    t(`difficulty.${course.difficulty}`),
  ].join(" · ");
  const status = completed ? t("learn.completedBadge") : course.enrolled ? t("common.percentDone", { percent: course.completionPercent }) : null;
  const label = [title, t(`categories.${course.category}`), meta, status].filter(Boolean).join(". ");

  return (
    <Card onPress={onPress} accessibilityLabel={label} accessibilityHint={t("learn.openCourse")} style={styles.card}>
      <View style={styles.row}>
        <View style={[styles.thumb, { backgroundColor: theme.surfaceAlt }]}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.image} resizeMode="cover" accessibilityIgnoresInvertColors onError={() => setThumbFailed(true)} />
          ) : (
            <Feather name={categoryIcon(course.category)} size={32} color={accent} />
          )}
        </View>
        <View style={styles.body}>
          <View style={styles.badges}>
            <Badge label={t(`categories.${course.category}`)} color={theme.text} tint={theme.surfaceAlt} />
            {completed ? <Badge label={t("learn.completedBadge")} color={theme.success} tint={theme.successTint} /> : null}
          </View>
          <ThemedText type="h4" numberOfLines={2}>
            {title}
          </ThemedText>
          <ThemedText type="small" muted numberOfLines={1}>
            {meta}
          </ThemedText>
        </View>
      </View>
      {course.enrolled && !completed ? <ProgressBar percent={course.completionPercent} label={t("common.percentDone", { percent: course.completionPercent })} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.md },
  row: { flexDirection: "row", gap: Spacing.md },
  thumb: { width: THUMB, height: THUMB, borderRadius: BorderRadius.md, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  image: { width: THUMB, height: THUMB },
  body: { flex: 1, gap: Spacing.xs, justifyContent: "center" },
  badges: { flexDirection: "row", gap: Spacing.xs, flexWrap: "wrap" },
});
