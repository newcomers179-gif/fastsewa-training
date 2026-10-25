import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import type { KeyValueStore } from "./apiClient";

/**
 * Sign-in tokens live in the phone's keychain / keystore (encrypted, excluded from backups).
 * Everything else the app keeps (language, cached course text) is not secret and uses AsyncStorage.
 * The browser build exists for development only and has no keystore, so it falls back to AsyncStorage.
 */
export const secureStore: KeyValueStore =
  Platform.OS === "web"
    ? AsyncStorage
    : {
        getItem: (key) => SecureStore.getItemAsync(key),
        setItem: (key, value) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
        removeItem: (key) => SecureStore.deleteItemAsync(key),
      };

/** Tokens an older version of the app kept in plain AsyncStorage: remove them, they are never read again. */
export async function forgetLegacyTokens(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(["fastsewa_access_token", "fastsewa_refresh_token"]);
  } catch {
    /* nothing to clean up, or storage unavailable */
  }
}
