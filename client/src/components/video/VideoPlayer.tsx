import { parseYouTubeId } from "@shared/validation";
import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Banner, Button } from "@/components/ui";
import { Spacing } from "@/constants/theme";
import { API_BASE_URL } from "@/lib/config";
import { resolveMediaUrl } from "@/lib/media";
import type { LessonDetail } from "@/types";
import { FilePlayer } from "./FilePlayer";
import type { PlayerProps } from "./types";
import { YouTubePlayer } from "./YouTubePlayer";

/** Picks the right player for a lesson's video and explains, in words, why it cannot play when it cannot. */
export function VideoPlayer({ lesson, startAt, onReport }: { lesson: LessonDetail; startAt: number; onReport: PlayerProps["onReport"] }) {
  const { t } = useTranslation();
  const [failure, setFailure] = useState<null | "load" | "blocked">(null);
  const [attempt, setAttempt] = useState(0);

  const youtubeId = lesson.videoUrl && (lesson.videoProvider === "youtube" || lesson.videoProvider === null) ? parseYouTubeId(lesson.videoUrl) : null;
  const uri = youtubeId ? null : resolveMediaUrl(lesson.videoUrl, API_BASE_URL);

  if (!youtubeId && !uri) return <Banner tone="warning">{t("lesson.videoUnavailable")}</Banner>;

  if (failure) {
    return (
      <View style={styles.failure}>
        <Banner tone="error">{failure === "blocked" ? t("lesson.videoBlocked") : t("lesson.videoError")}</Banner>
        {failure === "load" ? (
          <Button
            label={t("common.retry")}
            variant="secondary"
            onPress={() => {
              setFailure(null);
              setAttempt((n) => n + 1);
            }}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.frame}>
      {youtubeId ? (
        <YouTubePlayer key={attempt} videoId={youtubeId} startAt={startAt} onReport={onReport} onError={setFailure} label={lesson.title} />
      ) : (
        <FilePlayer key={attempt} uri={uri ?? ""} startAt={startAt} onReport={onReport} onError={setFailure} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000", borderRadius: 12, overflow: "hidden" },
  failure: { gap: Spacing.sm },
});
