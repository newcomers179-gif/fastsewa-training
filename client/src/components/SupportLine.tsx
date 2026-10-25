import React from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui";
import { ThemedText } from "@/components/ThemedText";
import { Spacing } from "@/constants/theme";
import type { AppConfig } from "@/types";

/** "Need help? Call … / Email …", when the organisation has given a contact in the server settings. */
export function SupportLine({ config }: { config: Pick<AppConfig, "supportPhone" | "supportEmail"> }) {
  const { t } = useTranslation();
  const { supportPhone, supportEmail } = config;
  if (!supportPhone && !supportEmail) return null;
  return (
    <View style={styles.wrap}>
      <ThemedText muted style={styles.center}>
        {t("auth.login.needHelp")}
      </ThemedText>
      {supportPhone ? <Button variant="secondary" icon="phone" label={t("profile.callSupport", { phone: supportPhone })} onPress={() => void Linking.openURL(`tel:${supportPhone.replace(/\s+/g, "")}`)} /> : null}
      {supportEmail ? <Button variant="secondary" icon="mail" label={t("profile.emailSupport", { email: supportEmail })} onPress={() => void Linking.openURL(`mailto:${supportEmail}`)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm, marginTop: Spacing.md },
  center: { textAlign: "center" },
});
