import type { TextStyle } from "react-native";

/**
 * Colours are chosen so that every text/background pair used in the app meets WCAG AA (4.5:1) and
 * every control outline meets 3:1 — in light and dark mode. The old brand orange (#FF6B2C) with
 * white text measured 2.8:1, which is unreadable in sunlight on a site; buttons now use a deeper
 * orange. client/tests/theme.test.ts recomputes these ratios, so a future edit cannot quietly break them.
 */
export interface Palette {
  /** Buttons, active tab, links — white text on it passes AA. */
  primary: string;
  onPrimary: string;
  /** Orange used as text on the page background. */
  primaryText: string;
  primaryTint: string;
  /** Decorative brand colour (never carries text). */
  brand: string;
  success: string;
  successTint: string;
  error: string;
  errorTint: string;
  warning: string;
  warningTint: string;
  text: string;
  textSecondary: string;
  /** Screen background. */
  background: string;
  /** Cards and bars. */
  surface: string;
  /** Inputs, chips, tracks. */
  surfaceAlt: string;
  /** Decorative separators and card outlines. */
  border: string;
  /** Outline of a control the learner must find (inputs, checkboxes). */
  controlBorder: string;
  shadow: string;
}

export const Colors: { light: Palette; dark: Palette } = {
  light: {
    primary: "#C2410C",
    onPrimary: "#FFFFFF",
    primaryText: "#C2410C",
    primaryTint: "#FFF1E8",
    brand: "#FF6B2C",
    success: "#166534",
    successTint: "#E7F6EC",
    error: "#B91C1C",
    errorTint: "#FDECEA",
    warning: "#92400E",
    warningTint: "#FEF3C7",
    text: "#1A1A1A",
    textSecondary: "#5B6472",
    background: "#F7F6F3",
    surface: "#FFFFFF",
    surfaceAlt: "#F3F4F6",
    border: "#E5E7EB",
    controlBorder: "#7D848E",
    shadow: "#000000",
  },
  dark: {
    primary: "#C94510",
    onPrimary: "#FFFFFF",
    primaryText: "#FF8A57",
    primaryTint: "#3A2A22",
    brand: "#FF7A40",
    success: "#4ADE80",
    successTint: "#16301F",
    error: "#F87171",
    errorTint: "#3B1D1D",
    warning: "#FBBF24",
    warningTint: "#3B2F12",
    text: "#F9FAFB",
    textSecondary: "#B4BCC8",
    background: "#111827",
    surface: "#1F2937",
    surfaceAlt: "#374151",
    border: "#374151",
    controlBorder: "#8E98A8",
    shadow: "#000000",
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  "2xl": 32,
  "3xl": 48,
} as const;

export const BorderRadius = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  "2xl": 24,
  full: 9999,
} as const;

/** Worker-friendly type scale: nothing below 13, comfortable line heights, bold where it matters. */
export const Typography = {
  h1: { fontSize: 28, fontWeight: "800", letterSpacing: -0.4, lineHeight: 34 },
  h2: { fontSize: 22, fontWeight: "700", letterSpacing: -0.2, lineHeight: 28 },
  h3: { fontSize: 19, fontWeight: "700", lineHeight: 25 },
  h4: { fontSize: 17, fontWeight: "600", lineHeight: 23 },
  body: { fontSize: 16, fontWeight: "400", lineHeight: 24 },
  reading: { fontSize: 17, fontWeight: "400", lineHeight: 28 },
  small: { fontSize: 14, fontWeight: "400", lineHeight: 20 },
  caption: { fontSize: 13, fontWeight: "400", lineHeight: 18 },
} satisfies Record<string, TextStyle>;

export type TypographyKey = keyof typeof Typography;

/** Smallest comfortable touch target (WCAG 2.5.5 asks for 44; 48 is Android's own guideline). */
export const MIN_TOUCH = 48;

/** Text may grow with the phone's font-size setting, but not so far that layouts break. */
export const MAX_FONT_SCALE = 1.6;

/** Category accents (icons and badges only — text on them stays in the theme text colour). */
export const CATEGORY_COLOR: Record<string, string> = {
  safety: "#DC2626",
  basics: "#2563EB",
  tools: "#D97706",
  discipline: "#7C3AED",
  electrical: "#CA8A04",
  plumbing: "#0D9488",
  masonry: "#EA580C",
  equipment: "#16A34A",
};

export const CATEGORY_ICON: Record<string, string> = {
  safety: "shield",
  basics: "book",
  tools: "tool",
  discipline: "clock",
  electrical: "zap",
  plumbing: "droplet",
  masonry: "layers",
  equipment: "settings",
};
