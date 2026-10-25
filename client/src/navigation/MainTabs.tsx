import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import Feather from "@expo/vector-icons/Feather"; // this icon set only: importing the package root would bundle every font (about 4 MB)
import React from "react";
import { Text, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { MAX_FONT_SCALE } from "@/constants/theme";
import { useTheme } from "@/hooks/useTheme";
import LearnScreen from "@/screens/LearnScreen";
import ProfileScreen from "@/screens/ProfileScreen";
import TasksScreen from "@/screens/TasksScreen";
import type { TabParamList } from "@/types";

const Tab = createBottomTabNavigator<TabParamList>();

const ICONS: Record<keyof TabParamList, keyof typeof Feather.glyphMap> = {
  Learn: "book-open",
  Tasks: "check-square",
  Profile: "user",
};

const LABEL_SIZE = 13;
const LABEL_LINE = Math.ceil(LABEL_SIZE * 1.25);
const ICON_SIZE = 24;
// What React Navigation puts around the label inside the bar (measured in a browser: a 28-pt icon box, 5 pt of padding above and
// below each item, a 1-pt top border). The bar's own height must cover all of it or the label is squeezed to a sliver.
const ICON_BOX = 28;
const ITEM_PADDING = 10;
const BORDER = 1;
const BAR_PADDING = 3;

export function MainTabs() {
  const { theme } = useTheme();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  // The bar's default height (49) is made for 10-pt labels: with readable 13-pt labels, and larger still when the
  // phone's font size is raised, the text was cut off. Size the bar from what it has to hold instead.
  const labelHeight = Math.ceil(LABEL_LINE * Math.min(fontScale, MAX_FONT_SCALE));
  const barHeight = BORDER + BAR_PADDING + ITEM_PADDING + ICON_BOX + labelHeight + BAR_PADDING + insets.bottom;
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: theme.primaryText,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border, height: barHeight, paddingTop: BAR_PADDING, paddingBottom: BAR_PADDING + insets.bottom },
        // our own label so the text scale is capped at the same MAX_FONT_SCALE the bar height was computed with
        tabBarLabel: ({ color, children }) => (
          <Text numberOfLines={1} allowFontScaling maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color, fontSize: LABEL_SIZE, lineHeight: LABEL_LINE, fontWeight: "600", textAlign: "center" }}>
            {children}
          </Text>
        ),
        tabBarIcon: ({ color }) => <Feather name={ICONS[route.name]} size={ICON_SIZE} color={color} />,
      })}
    >
      <Tab.Screen name="Learn" component={LearnScreen} options={{ title: t("tabs.learn"), tabBarAccessibilityLabel: t("tabs.learn") }} />
      <Tab.Screen name="Tasks" component={TasksScreen} options={{ title: t("tabs.tasks"), tabBarAccessibilityLabel: t("tabs.tasks") }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ title: t("tabs.profile"), tabBarAccessibilityLabel: t("tabs.profile") }} />
    </Tab.Navigator>
  );
}

