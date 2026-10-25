/**
 * The whole app is one stack; which screens exist depends on who is signed in, so signing out (or the
 * server ending the session) removes every signed-in screen at once and no back-swipe can return to them.
 */
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LoadingView, Screen } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "@/hooks/useTheme";
import { API_CONFIG_PROBLEM } from "@/lib/config";
import { MainTabs } from "./MainTabs";
import ChangePasswordScreen from "@/screens/ChangePasswordScreen";
import CourseDetailScreen from "@/screens/CourseDetailScreen";
import DeleteAccountScreen from "@/screens/DeleteAccountScreen";
import EditProfileScreen from "@/screens/EditProfileScreen";
import ForgotPasswordScreen from "@/screens/ForgotPasswordScreen";
import LessonDetailScreen from "@/screens/LessonDetailScreen";
import LoginScreen from "@/screens/LoginScreen";
import ModuleDetailScreen from "@/screens/ModuleDetailScreen";
import QuizScreen from "@/screens/QuizScreen";
import RegisterScreen from "@/screens/RegisterScreen";
import ResetPasswordScreen from "@/screens/ResetPasswordScreen";
import SearchScreen from "@/screens/SearchScreen";
import { ConfigErrorScreen, UnreachableScreen } from "@/screens/StatusScreens";
import type { AppParamList } from "@/types";

const Stack = createNativeStackNavigator<AppParamList>();

export function RootNavigator() {
  const { status, user } = useAuth();
  const { theme, isDark } = useTheme();
  const { t } = useTranslation();

  const navTheme = useMemo<Theme>(() => {
    const base = isDark ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, primary: theme.primaryText, background: theme.background, card: theme.surface, text: theme.text, border: theme.border, notification: theme.primary } };
  }, [theme, isDark]);

  if (API_CONFIG_PROBLEM) return <ConfigErrorScreen problem={API_CONFIG_PROBLEM} />;
  if (status === "loading") {
    return (
      <Screen>
        <LoadingView message={t("common.appName")} />
      </Screen>
    );
  }
  if (status === "unreachable") return <UnreachableScreen />;

  const header = {
    headerStyle: { backgroundColor: theme.surface },
    headerTintColor: theme.text,
    headerTitleStyle: { fontWeight: "700" as const },
    headerShadowVisible: false,
    headerBackTitle: t("common.back"),
    contentStyle: { backgroundColor: theme.background },
  };

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={header}>
        {status === "signedOut" ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
            <Stack.Screen name="Register" component={RegisterScreen} options={{ title: t("nav.register") }} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: t("nav.forgotPassword") }} />
            <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ title: t("nav.resetPassword") }} />
          </>
        ) : user?.mustChangePassword ? (
          <Stack.Screen name="ForcedPassword" component={ChangePasswordScreen} options={{ title: t("auth.change.forcedTitle"), headerBackVisible: false, gestureEnabled: false }} />
        ) : (
          <>
            <Stack.Screen name="Tabs" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen name="CourseDetail" component={CourseDetailScreen} options={{ title: t("nav.course") }} />
            <Stack.Screen name="ModuleDetail" component={ModuleDetailScreen} options={{ title: t("nav.module") }} />
            <Stack.Screen name="LessonDetail" component={LessonDetailScreen} options={{ title: t("nav.lesson") }} />
            <Stack.Screen name="Quiz" component={QuizScreen} options={{ title: t("nav.quiz"), gestureEnabled: false }} />
            <Stack.Screen name="Search" component={SearchScreen} options={{ title: t("nav.search") }} />
            <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: t("nav.editProfile") }} />
            <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: t("nav.changePassword") }} />
            <Stack.Screen name="DeleteAccount" component={DeleteAccountScreen} options={{ title: t("nav.deleteAccount") }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
