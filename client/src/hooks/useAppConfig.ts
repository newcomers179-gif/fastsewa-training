import { useQuery } from "@tanstack/react-query";
import { configOptions } from "@/lib/queries";
import type { AppConfig } from "@/types";

/** What the app assumes until the server has answered (and when it cannot be reached): the app still lets people sign in. */
export const DEFAULT_CONFIG: AppConfig = {
  apiVersion: 1,
  registrationMode: "open",
  registrationCodeRequired: false,
  passwordResetByEmail: true,
  consentVersion: "",
  privacyPolicyUrl: null,
  termsUrl: null,
  supportEmail: null,
  supportPhone: null,
  serverTime: "",
};

export function useAppConfig(): { config: AppConfig; loaded: boolean } {
  const query = useQuery(configOptions());
  return { config: query.data ?? DEFAULT_CONFIG, loaded: query.data !== undefined };
}
