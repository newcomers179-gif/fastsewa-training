import React from "react";
import { useTranslation } from "react-i18next";
import { Segmented } from "@/components/ui";
import { useAuth } from "@/hooks/useAuth";
import { useLang } from "@/hooks/useLang";

/** English | हिन्दी. Each language is written in itself, so it can be found without reading the current one. */
export function LanguageSwitch() {
  const { t } = useTranslation();
  const { setLanguage } = useAuth();
  const lang = useLang();
  return (
    <Segmented
      label={t("profile.language")}
      value={lang}
      onChange={(next) => void setLanguage(next)}
      options={[
        { value: "en", label: "English" },
        { value: "hi", label: "हिन्दी" },
      ]}
    />
  );
}
