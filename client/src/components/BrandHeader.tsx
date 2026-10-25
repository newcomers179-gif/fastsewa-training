import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { ThemedText } from "@/components/ThemedText";
import { BorderRadius, Spacing } from "@/constants/theme";

const ICON = require("../../assets/images/icon.png") as number;

/** The logo with a title (and optional line below it), at the top of the sign-in screens. */
export function BrandHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.wrap}>
      <Image source={ICON} style={styles.logo} accessibilityIgnoresInvertColors accessibilityLabel="" />
      <ThemedText type="h1" accessibilityRole="header" style={styles.center}>
        {title}
      </ThemedText>
      {subtitle ? (
        <ThemedText muted style={styles.center}>
          {subtitle}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: Spacing.sm, marginVertical: Spacing.lg },
  logo: { width: 84, height: 84, borderRadius: BorderRadius.xl },
  center: { textAlign: "center" },
});
