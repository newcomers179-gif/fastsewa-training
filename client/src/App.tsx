// First import: loading it starts i18next (and picks the phone's language) before any screen can render.
import { loadStoredLanguage } from "@/i18n";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/hooks/useAuth";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { useTheme } from "@/hooks/useTheme";
import { installNotificationHandler } from "@/lib/push";
import { installQueryManagers, persistOptions, queryClient } from "@/lib/queryClient";
import { RootNavigator } from "@/navigation";

// Keep the native splash screen up until the saved language is applied, so the first screen is never in the wrong language.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
installNotificationHandler();

function Shell() {
  const { isDark } = useTheme();
  usePushNotifications();
  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <RootNavigator />
    </>
  );
}

export default function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void loadStoredLanguage().finally(() => setReady(true));
  }, []);
  useEffect(() => installQueryManagers(), []);
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
          <AuthProvider>
            <Shell />
          </AuthProvider>
        </PersistQueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
