/**
 * Push notifications: ask permission, get this phone's Expo push address and give it to the server so
 * the administrators' broadcasts reach it. Everything is best effort: a learner who says no, or a
 * phone without Google services, simply does not get push, and nothing else changes.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { api } from "./api";

const TOKEN_KEY = "fastsewa.pushToken";
const ASKED_KEY = "fastsewa.pushAsked";
/** Must match the `channelId` the server sends with every message (server/services/notification.ts). */
export const ANDROID_CHANNEL = "training-reminders";

/** Banners while the app is open. (`shouldShowAlert` is deprecated since SDK 53.) */
export function installNotificationHandler(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

function easProjectId(): string | null {
  const id = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  return id && !/YOUR[_-]|<|\.\.\./i.test(id) ? id : null;
}

/** The address of this phone, or null when push is not possible (web, emulator, no permission, project not configured). */
export async function getPushToken(): Promise<string | null> {
  if (Platform.OS === "web" || !Device.isDevice) return null;
  const projectId = easProjectId();
  if (!projectId) return null; // a build made before `eas init`: push stays off, nothing breaks

  if (Platform.OS === "android") {
    // The channel must exist before the permission prompt appears on Android 13+.
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
      name: "Training reminders",
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    // Ask once, not on every launch: someone who said no has decided.
    if ((await AsyncStorage.getItem(ASKED_KEY)) === "1") return null;
    await AsyncStorage.setItem(ASKED_KEY, "1");
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== "granted") return null;
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
}

/** Tells the server about this phone (idempotent: the server keeps one row per address). */
export async function registerPushToken(): Promise<void> {
  const token = await getPushToken();
  if (!token) return;
  await api.post("/auth/push-token", { token, platform: Platform.OS === "ios" ? "ios" : "android" });
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

/** On sign-out: stop this phone receiving the previous person's broadcasts. */
export async function unregisterPushToken(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  try {
    await api.delete("/auth/push-token", { token });
  } finally {
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
}
