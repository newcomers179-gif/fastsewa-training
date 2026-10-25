import React from "react";
import { Text, type TextProps } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { MAX_FONT_SCALE, Typography, type TypographyKey } from "@/constants/theme";

interface ThemedTextProps extends TextProps {
  type?: TypographyKey;
  /** Use the secondary (muted) colour. */
  muted?: boolean;
}

export function ThemedText({ type = "body", muted = false, style, ...props }: ThemedTextProps) {
  const { theme } = useTheme();
  return <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[{ color: muted ? theme.textSecondary : theme.text }, Typography[type], style]} {...props} />;
}
