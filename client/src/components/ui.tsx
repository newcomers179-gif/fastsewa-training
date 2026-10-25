/**
 * The small set of building blocks every screen is made of. Keeping them in one place is what makes the
 * accessibility rules hold everywhere: 48-point touch targets, visible labels (not placeholders alone),
 * errors announced to screen readers, state spoken for checkboxes and busy buttons, and colours that
 * pass contrast in light and dark mode.
 */
import React, { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather"; // this icon set only: importing the package root would bundle every font (about 4 MB)
import { useTranslation } from "react-i18next";
import { ThemedText } from "@/components/ThemedText";
import { BorderRadius, CATEGORY_ICON, MAX_FONT_SCALE, MIN_TOUCH, Spacing, Typography } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
import { ApiError } from "@/lib/apiClient";
import { errorMessage } from "@/lib/errors";

export type IconName = keyof typeof Feather.glyphMap;

/** The icon of a course category (every name in CATEGORY_ICON is a Feather glyph). */
export function categoryIcon(category: string): IconName {
  return (CATEGORY_ICON[category] ?? "book") as IconName;
}

// ─── layout ──────────────────────────────────────────────────────────────────
export function Screen({ children, style, edges }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; edges?: ("top" | "bottom" | "left" | "right")[] }) {
  const { theme } = useTheme();
  return (
    <SafeAreaView edges={edges} style={[{ flex: 1, backgroundColor: theme.background }, style]}>
      {children}
    </SafeAreaView>
  );
}

export function Card({ children, style, onPress, accessibilityLabel, accessibilityHint, disabled }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; onPress?: () => void; accessibilityLabel?: string; accessibilityHint?: string; disabled?: boolean }) {
  const { theme } = useTheme();
  // Phones draw the soft shadow with the shadow* props and elevation; the web build uses boxShadow (it warns about shadow*).
  const shadow: ViewStyle =
    Platform.OS === "web"
      ? { boxShadow: "0 2px 8px rgba(0, 0, 0, 0.06)" }
      : { shadowColor: theme.shadow, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 };
  const base: StyleProp<ViewStyle> = [styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, shadow, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [base, pressed && styles.pressed, disabled && styles.disabled]}
    >
      {children}
    </Pressable>
  );
}

/** A scrolling form that stays reachable above the keyboard and keeps taps working while a field is focused. */
export function FormScroll({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.form, style]} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function SectionTitle({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <ThemedText type="h3" accessibilityRole="header">
        {children}
      </ThemedText>
    </View>
  );
}

// ─── buttons ─────────────────────────────────────────────────────────────────
export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export function Button({
  label,
  onPress,
  variant = "primary",
  icon,
  loading = false,
  disabled = false,
  style,
  accessibilityHint,
  compact = false,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  compact?: boolean;
}) {
  const { theme } = useTheme();
  const inactive = disabled || loading;
  const colors = {
    primary: { bg: theme.primary, fg: theme.onPrimary, border: theme.primary },
    secondary: { bg: theme.surfaceAlt, fg: theme.text, border: theme.controlBorder },
    danger: { bg: "transparent", fg: theme.error, border: theme.error },
    ghost: { bg: "transparent", fg: theme.primaryText, border: "transparent" },
  }[variant];
  return (
    <Pressable
      // `disabled` (not only accessibilityState) so the web build also exposes aria-disabled and drops the button from the tab order
      disabled={inactive}
      onPress={inactive ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        compact && styles.buttonCompact,
        { backgroundColor: colors.bg, borderColor: colors.border },
        pressed && !inactive && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.fg} />
      ) : (
        <>
          {icon ? <Feather name={icon} size={20} color={colors.fg} /> : null}
          <ThemedText style={{ color: colors.fg, fontWeight: "700", flexShrink: 1, textAlign: "center" }}>{label}</ThemedText>
        </>
      )}
    </Pressable>
  );
}

export function IconButton({ icon, label, onPress, color, size = 22 }: { icon: IconName; label: string; onPress: () => void; color?: string; size?: number }) {
  const { theme } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
      <Feather name={icon} size={size} color={color ?? theme.text} />
    </Pressable>
  );
}

// ─── form fields ─────────────────────────────────────────────────────────────
export interface TextFieldProps extends Omit<TextInputProps, "style" | "secureTextEntry" | "accessibilityLabel"> {
  label: string;
  error?: string | undefined;
  hint?: string | undefined;
  /** A password field: dots, with a show/hide toggle. */
  secure?: boolean;
  optional?: boolean;
}

export const TextField = React.forwardRef<TextInput, TextFieldProps>(function TextField({ label, error, hint, secure = false, optional = false, ...input }, ref) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const labelText = optional ? `${label} (${t("common.optional")})` : label;
  return (
    <View style={styles.field}>
      <ThemedText type="small" style={styles.label}>
        {labelText}
      </ThemedText>
      <View style={[styles.inputBox, { backgroundColor: theme.surfaceAlt, borderColor: error ? theme.error : theme.controlBorder }]}>
        <TextInput
          ref={ref}
          {...input}
          secureTextEntry={secure && !shown}
          accessibilityLabel={labelText}
          accessibilityHint={hint}
          placeholderTextColor={theme.textSecondary}
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={[styles.input, { color: theme.text }]}
        />
        {secure ? (
          <Pressable onPress={() => setShown((s) => !s)} accessibilityRole="button" accessibilityLabel={shown ? t("common.hidePassword") : t("common.showPassword")} hitSlop={8} style={styles.reveal}>
            <Feather name={shown ? "eye-off" : "eye"} size={20} color={theme.textSecondary} />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <ThemedText type="small" accessibilityRole="alert" accessibilityLiveRegion="polite" style={{ color: theme.error }}>
          {error}
        </ThemedText>
      ) : hint ? (
        <ThemedText type="small" muted>
          {hint}
        </ThemedText>
      ) : null}
    </View>
  );
});

export function Checkbox({ checked, onChange, children, error }: { checked: boolean; onChange: (next: boolean) => void; children: React.ReactNode; error?: string | undefined }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: Spacing.xs }}>
      <View style={styles.checkRow}>
        <Pressable
          onPress={() => onChange(!checked)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
          hitSlop={10}
          style={[styles.checkBox, { borderColor: error ? theme.error : theme.controlBorder, backgroundColor: checked ? theme.primary : "transparent" }]}
        >
          {checked ? <Feather name="check" size={18} color={theme.onPrimary} /> : null}
        </Pressable>
        <View style={{ flex: 1 }}>{children}</View>
      </View>
      {error ? (
        <ThemedText type="small" accessibilityRole="alert" style={{ color: theme.error }}>
          {error}
        </ThemedText>
      ) : null}
    </View>
  );
}

/** A small selectable pill (category filters). */
export function Chip({ label, selected, onPress, icon }: { label: string; selected: boolean; onPress: () => void; icon?: IconName }) {
  const { theme } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={[styles.chip, { backgroundColor: selected ? theme.primary : theme.surface, borderColor: selected ? theme.primary : theme.controlBorder }]}
    >
      {icon ? <Feather name={icon} size={16} color={selected ? theme.onPrimary : theme.textSecondary} /> : null}
      <ThemedText type="small" style={{ color: selected ? theme.onPrimary : theme.text, fontWeight: "600" }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** Pick one of a few options (language, filter). */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: readonly { value: T; label: string }[]; value: T; onChange: (value: T) => void; label?: string }) {
  const { theme } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.segmented}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[styles.segment, { backgroundColor: selected ? theme.primary : theme.surfaceAlt, borderColor: selected ? theme.primary : theme.controlBorder }]}
          >
            <ThemedText style={{ color: selected ? theme.onPrimary : theme.text, fontWeight: "600" }}>{option.label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── messages ────────────────────────────────────────────────────────────────
export type BannerTone = "info" | "success" | "warning" | "error";

export function Banner({ tone = "info", children, icon, style }: { tone?: BannerTone; children: React.ReactNode; icon?: IconName; style?: StyleProp<ViewStyle> }) {
  const { theme } = useTheme();
  const palette = {
    info: { bg: theme.surfaceAlt, fg: theme.text, icon: "info" as IconName },
    success: { bg: theme.successTint, fg: theme.success, icon: "check-circle" as IconName },
    warning: { bg: theme.warningTint, fg: theme.warning, icon: "alert-triangle" as IconName },
    error: { bg: theme.errorTint, fg: theme.error, icon: "alert-circle" as IconName },
  }[tone];
  return (
    <View accessibilityRole={tone === "error" ? "alert" : undefined} accessibilityLiveRegion={tone === "error" ? "polite" : "none"} style={[styles.banner, { backgroundColor: palette.bg }, style]}>
      <Feather name={icon ?? palette.icon} size={20} color={palette.fg} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: Spacing.xs }}>
        {typeof children === "string" ? <ThemedText style={{ color: palette.fg }}>{children}</ThemedText> : children}
      </View>
    </View>
  );
}

export function Badge({ label, color, tint }: { label: string; color: string; tint: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: tint }]}>
      <ThemedText type="caption" style={{ color, fontWeight: "700" }}>
        {label}
      </ThemedText>
    </View>
  );
}

// ─── whole-screen states ─────────────────────────────────────────────────────
export function LoadingView({ message }: { message?: string }) {
  const { theme } = useTheme();
  const { t } = useTranslation();
  return (
    <View style={styles.center} accessibilityRole="progressbar" accessibilityLabel={message ?? t("common.loading")}>
      <ActivityIndicator size="large" color={theme.primaryText} />
      {message ? (
        <ThemedText muted style={{ marginTop: Spacing.lg }}>
          {message}
        </ThemedText>
      ) : null}
    </View>
  );
}

export function EmptyView({ icon, title, body, actionLabel, onAction }: { icon: IconName; title: string; body?: string; actionLabel?: string; onAction?: () => void }) {
  const { theme } = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: theme.surfaceAlt }]}>
        <Feather name={icon} size={36} color={theme.textSecondary} />
      </View>
      <ThemedText type="h4" style={{ textAlign: "center" }}>
        {title}
      </ThemedText>
      {body ? (
        <ThemedText muted style={{ textAlign: "center" }}>
          {body}
        </ThemedText>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} style={{ marginTop: Spacing.md }} /> : null}
    </View>
  );
}

/** Something failed to load: say why in the learner's language and offer to try again. */
export function ErrorView({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const offline = error instanceof ApiError && error.isConnectionProblem;
  return (
    <EmptyView
      icon={offline ? "wifi-off" : "alert-circle"}
      title={offline ? t("common.offlineTitle") : t("common.errorTitle")}
      body={offline ? t("common.offlineNoData") : errorMessage(error, t)}
      {...(onRetry ? { actionLabel: t("common.retry"), onAction: onRetry } : {})}
    />
  );
}

export function OfflineBanner() {
  const { t } = useTranslation();
  return <Banner tone="warning" icon="wifi-off">{t("common.offline")}</Banner>;
}

export function ProgressBar({ percent, label, height = 8 }: { percent: number; label?: string; height?: number }) {
  const { theme } = useTheme();
  const value = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 0, max: 100, now: value }} style={[styles.track, { height, borderRadius: height / 2, backgroundColor: theme.border }]}>
      <View style={{ width: `${value}%`, height, borderRadius: height / 2, backgroundColor: theme.primaryText }} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  form: { padding: Spacing.xl, gap: Spacing.lg, paddingBottom: Spacing["3xl"] },
  card: {
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
  button: {
    minHeight: MIN_TOUCH + 4,
    borderRadius: BorderRadius.full,
    borderWidth: 1.5,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
  },
  buttonCompact: { minHeight: MIN_TOUCH, paddingHorizontal: Spacing.lg },
  iconButton: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: "center", justifyContent: "center" },
  field: { gap: Spacing.xs },
  label: { fontWeight: "600" },
  inputBox: { minHeight: MIN_TOUCH + 4, borderRadius: BorderRadius.sm, borderWidth: 1.5, flexDirection: "row", alignItems: "center" },
  input: { flex: 1, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, ...Typography.body },
  reveal: { paddingHorizontal: Spacing.md, minHeight: MIN_TOUCH, justifyContent: "center" },
  checkRow: { flexDirection: "row", gap: Spacing.md, alignItems: "flex-start" },
  checkBox: { width: 28, height: 28, borderRadius: BorderRadius.xs, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 2 },
  chip: { minHeight: MIN_TOUCH - 8, flexDirection: "row", alignItems: "center", gap: Spacing.xs, paddingHorizontal: Spacing.md, borderRadius: BorderRadius.full, borderWidth: 1.5 },
  segmented: { flexDirection: "row", gap: Spacing.md },
  segment: { flex: 1, minHeight: MIN_TOUCH, borderRadius: BorderRadius.sm, borderWidth: 1.5, alignItems: "center", justifyContent: "center", paddingHorizontal: Spacing.sm },
  banner: { flexDirection: "row", gap: Spacing.md, padding: Spacing.md, borderRadius: BorderRadius.md },
  badge: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: BorderRadius.xs, alignSelf: "flex-start" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: Spacing.xl },
  empty: { alignItems: "center", gap: Spacing.sm, paddingHorizontal: Spacing["2xl"], paddingVertical: Spacing["3xl"] },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: Spacing.xs },
  track: { overflow: "hidden", alignSelf: "stretch" },
});
