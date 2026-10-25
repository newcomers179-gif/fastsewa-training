import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { registerPushToken } from "@/lib/push";

/** Once someone is signed in (and past any forced password change), give the server this phone's push address. */
export function usePushNotifications(): void {
  const { status, user } = useAuth();
  const ready = status === "signedIn" && user !== null && !user.mustChangePassword;
  const userId = user?.id;
  useEffect(() => {
    if (!ready) return;
    registerPushToken().catch(() => {
      /* push is optional: no permission, no signal or an unconfigured build must never disturb the app */
    });
  }, [ready, userId]);
}
