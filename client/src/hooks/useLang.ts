import type { Lang } from "@shared/constants";
import { useTranslation } from "react-i18next";

/** The language the screen is currently drawn in ("en" or "hi"). */
export function useLang(): Lang {
  const { i18n } = useTranslation();
  return i18n.language === "hi" ? "hi" : "en";
}
