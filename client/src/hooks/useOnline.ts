import { onlineManager } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

/** False only when the phone reports no connection; "unknown yet" counts as online. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => onlineManager.subscribe(listener),
    () => onlineManager.isOnline(),
    () => true
  );
}
