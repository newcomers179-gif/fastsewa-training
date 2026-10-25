import React from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button, EmptyView, Screen } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import type { ApiUrlResult } from "@/lib/config";

/**
 * Shown instead of the app when it was built without a usable server address. Nobody can fix that
 * from the phone, so the message says what happened in plain words for whoever installed it.
 */
export function ConfigErrorScreen({ problem }: { problem: NonNullable<ApiUrlResult["problem"]> }) {
  const { t } = useTranslation();
  return (
    <Screen>
      <EmptyView icon="settings" title={t("config.title")} body={`${t("config.body")}\n\n${t(`config.problem.${problem}`)}`} />
    </Screen>
  );
}

/** A session is stored on the phone, but the server cannot be reached and nothing has been saved yet. */
export function UnreachableScreen() {
  const { t } = useTranslation();
  const { retry, logout } = useAuth();
  return (
    <Screen>
      <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24, gap: 8 }}>
        <EmptyView icon="wifi-off" title={t("unreachable.title")} body={t("unreachable.body")} actionLabel={t("common.retry")} onAction={() => void retry()} />
        <Button variant="ghost" label={t("profile.logout")} onPress={() => void logout()} />
      </View>
    </Screen>
  );
}
