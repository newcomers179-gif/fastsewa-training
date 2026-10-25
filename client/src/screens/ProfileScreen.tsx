import { useQuery } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather"; // this icon set only: importing the package root would bundle every font (about 4 MB)
import Constants from "expo-constants";
import React, { useState } from "react";
import { Linking, Pressable, RefreshControl, ScrollView, Share, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { SupportLine } from "@/components/SupportLine";
import { ThemedText } from "@/components/ThemedText";
import { Badge, Banner, Button, Card, Screen, SectionTitle } from "@/components/ui";
import { BorderRadius, MIN_TOUCH, Spacing } from "@/constants/theme";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useAuth, useUser } from "@/hooks/useAuth";
import { useCertificateActions } from "@/hooks/useCertificateActions";
import { useLang } from "@/hooks/useLang";
import { useTheme } from "@/hooks/useTheme";
import { confirmAction } from "@/lib/confirm";
import { errorMessage } from "@/lib/errors";
import { formatDate, formatMonthYear, initialOf, pick } from "@/lib/format";
import { certificatesOptions, statsOptions } from "@/lib/queries";
import { countText } from "@/lib/translate";
import { useAppNavigation } from "@/navigation/hooks";

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const lang = useLang();
  const user = useUser();
  const { logout, exportData } = useAuth();
  const { config } = useAppConfig();
  const navigation = useAppNavigation();
  const stats = useQuery(statsOptions());
  const certificates = useQuery(certificatesOptions());
  const certActions = useCertificateActions();
  const [notice, setNotice] = useState<unknown>(null);
  const [exporting, setExporting] = useState(false);

  const confirmLogout = async () => {
    const yes = await confirmAction({ title: t("profile.logoutTitle"), message: t("profile.logoutBody"), confirmLabel: t("profile.logout"), cancelLabel: t("common.cancel"), destructive: true });
    if (yes) await logout();
  };

  const downloadMyData = async () => {
    setExporting(true);
    setNotice(null);
    try {
      await Share.share({ title: t("profile.myData"), message: await exportData() });
    } catch (e) {
      setNotice(e);
    } finally {
      setExporting(false);
    }
  };

  const open = (url: string | null) => {
    if (url) void Linking.openURL(url);
  };

  const s = stats.data;
  const learning = s ? (s.learningMinutes < 60 ? countText(t, "common.minutes", s.learningMinutes) : t("profile.hours", { n: (s.learningMinutes / 60).toFixed(1) })) : "–";
  const tiles: { label: string; value: string }[] = [
    { label: t("profile.stats.courses"), value: s ? String(s.coursesEnrolled) : "–" },
    { label: t("profile.stats.completed"), value: s ? String(s.coursesCompleted) : "–" },
    { label: t("profile.stats.lessons"), value: s ? String(s.lessonsCompleted) : "–" },
    { label: t("profile.stats.modules"), value: s ? String(s.modulesCompleted) : "–" },
    { label: t("profile.stats.certificates"), value: s ? String(s.certificatesEarned) : "–" },
    { label: t("profile.stats.time"), value: learning },
  ];

  return (
    <Screen edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={stats.isRefetching || certificates.isRefetching}
            onRefresh={() => {
              void stats.refetch();
              void certificates.refetch();
            }}
            tintColor={theme.primaryText}
            colors={[theme.primaryText]}
          />
        }
      >
        <View style={styles.identity}>
          <View style={[styles.avatar, { backgroundColor: theme.primary }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <ThemedText type="h1" style={{ color: theme.onPrimary }}>
              {initialOf(user.displayName)}
            </ThemedText>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <ThemedText type="h2" accessibilityRole="header" numberOfLines={2}>
              {user.displayName}
            </ThemedText>
            <ThemedText muted>@{user.username}</ThemedText>
            <ThemedText type="small" muted>
              {t("profile.memberSince", { date: formatMonthYear(user.createdAt, lang) })}
            </ThemedText>
            {user.role !== "worker" ? <Badge label={t(`profile.role.${user.role}`)} color={theme.text} tint={theme.surfaceAlt} /> : null}
          </View>
        </View>

        <View style={styles.tiles}>
          {tiles.map((tile) => (
            <View key={tile.label} style={[styles.tile, { backgroundColor: theme.surface, borderColor: theme.border }]} accessible accessibilityLabel={`${tile.label}: ${tile.value}`}>
              <ThemedText type="h2">{tile.value}</ThemedText>
              <ThemedText type="caption" muted style={{ textAlign: "center" }}>
                {tile.label}
              </ThemedText>
            </View>
          ))}
        </View>

        <SectionTitle>{t("profile.language")}</SectionTitle>
        <LanguageSwitch />

        <SectionTitle>{t("profile.certificates")}</SectionTitle>
        {certActions.error ? <Banner tone="error">{errorMessage(certActions.error, t)}</Banner> : null}
        {certificates.data && certificates.data.length === 0 ? (
          <Card style={{ gap: Spacing.xs }}>
            <ThemedText type="h4">{t("profile.noCertificates")}</ThemedText>
            <ThemedText muted>{t("profile.noCertificatesBody")}</ThemedText>
          </Card>
        ) : null}
        {certificates.data?.map((certificate) => (
          <Card key={certificate.id} style={{ gap: Spacing.sm }}>
            <View style={styles.certHead}>
              <Feather name="award" size={26} color={certificate.revoked ? theme.textSecondary : theme.success} />
              <View style={{ flex: 1 }}>
                <ThemedText type="h4" numberOfLines={2}>
                  {pick(lang, certificate.courseTitle, certificate.courseTitleHi)}
                </ThemedText>
                <ThemedText type="small" muted>
                  {t("profile.earnedOn", { date: formatDate(certificate.earnedAt, lang) })} · {t("profile.certNo", { number: certificate.certificateNumber })}
                </ThemedText>
              </View>
            </View>
            {certificate.revoked ? (
              <Badge label={t("profile.revoked")} color={theme.error} tint={theme.errorTint} />
            ) : (
              <View style={styles.certActions}>
                <Button label={t("profile.download")} icon="download" compact onPress={() => void certActions.download(certificate.id)} loading={certActions.busyId === certificate.id} style={{ flex: 1 }} />
                <Button label={t("profile.share")} icon="share-2" variant="secondary" compact onPress={() => void certActions.share(certificate, lang)} style={{ flex: 1 }} />
              </View>
            )}
          </Card>
        ))}

        <SectionTitle>{t("profile.account")}</SectionTitle>
        {notice ? <Banner tone="error">{errorMessage(notice, t)}</Banner> : null}
        <Card style={styles.menu}>
          <Row icon="edit-2" label={t("profile.editProfile")} onPress={() => navigation.navigate("EditProfile")} />
          <Row icon="lock" label={t("profile.changePassword")} onPress={() => navigation.navigate("ChangePassword")} />
          {config.privacyPolicyUrl ? <Row icon="shield" label={t("profile.privacy")} onPress={() => open(config.privacyPolicyUrl)} /> : null}
          {config.termsUrl ? <Row icon="file-text" label={t("profile.terms")} onPress={() => open(config.termsUrl)} /> : null}
          <Row icon="download-cloud" label={exporting ? t("common.loading") : t("profile.myData")} onPress={() => void downloadMyData()} />
          <Row icon="trash-2" label={t("profile.deleteAccount")} danger onPress={() => navigation.navigate("DeleteAccount")} />
        </Card>

        <SupportLine config={config} />

        <Button label={t("profile.logout")} variant="danger" icon="log-out" onPress={() => void confirmLogout()} />
        <ThemedText type="caption" muted style={{ textAlign: "center" }}>
          {t("profile.version", { version: Constants.expoConfig?.version ?? "" })}
        </ThemedText>
      </ScrollView>
    </Screen>
  );
}

function Row({ icon, label, onPress, danger = false }: { icon: keyof typeof Feather.glyphMap; label: string; onPress: () => void; danger?: boolean }) {
  const { theme } = useTheme();
  const color = danger ? theme.error : theme.text;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <Feather name={icon} size={22} color={color} />
      <ThemedText style={{ flex: 1, color }}>{label}</ThemedText>
      <Feather name="chevron-right" size={20} color={theme.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing["3xl"] },
  identity: { flexDirection: "row", alignItems: "center", gap: Spacing.lg },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center" },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.md },
  tile: { flexGrow: 1, flexBasis: "30%", minWidth: 100, alignItems: "center", gap: 2, padding: Spacing.md, borderRadius: BorderRadius.md, borderWidth: 1 },
  certHead: { flexDirection: "row", gap: Spacing.md, alignItems: "center" },
  certActions: { flexDirection: "row", gap: Spacing.sm },
  menu: { padding: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: Spacing.md, minHeight: MIN_TOUCH + 8, paddingHorizontal: Spacing.lg },
});
