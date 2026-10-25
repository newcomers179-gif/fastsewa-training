import { Alert, Platform } from "react-native";

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  /** Style the confirm button as dangerous (delete, log out). */
  destructive?: boolean;
}

/** Ask "are you sure?" and resolve to the answer. Uses the browser's dialog on web, where Alert.alert does nothing. */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  if (Platform.OS === "web") {
    // The project compiles without the DOM typings (it is a phone app), so the browser's dialog is reached through globalThis.
    const browser = globalThis as { confirm?: (message?: string) => boolean };
    return Promise.resolve(typeof browser.confirm === "function" ? browser.confirm(`${options.title}\n\n${options.message}`) : false);
  }
  return new Promise((resolve) => {
    Alert.alert(
      options.title,
      options.message,
      [
        { text: options.cancelLabel, style: "cancel", onPress: () => resolve(false) },
        { text: options.confirmLabel, style: options.destructive ? "destructive" : "default", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) }
    );
  });
}
