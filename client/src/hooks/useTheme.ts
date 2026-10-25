import { useColorScheme } from "react-native";
import { Colors, type Palette } from "@/constants/theme";

export function useTheme(): { theme: Palette; isDark: boolean } {
  const isDark = useColorScheme() === "dark";
  return { theme: isDark ? Colors.dark : Colors.light, isDark };
}
