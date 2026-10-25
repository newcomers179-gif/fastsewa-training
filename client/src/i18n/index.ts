import AsyncStorage from "@react-native-async-storage/async-storage";
import { getLocales } from "expo-localization";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import type { Lang } from "@shared/constants";
import { en } from "./en";
import { hi } from "./hi";

const LANG_KEY = "fastsewa.lang";

/** Hindi when the phone is set to Hindi, English otherwise. */
export function deviceLanguage(): Lang {
  try {
    return getLocales()[0]?.languageCode === "hi" ? "hi" : "en";
  } catch {
    return "en";
  }
}

// i18next's default export is the instance itself; `.use()` and `.changeLanguage()` are its documented
// instance methods, not the package's same-named named exports.
/* eslint-disable import/no-named-as-default-member */
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, hi: { translation: hi } },
  lng: deviceLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  // Everything is bundled, so start up synchronously: no render ever sees a raw key, no Suspense boundary is needed.
  initAsync: false,
  react: { useSuspense: false },
});

export function currentLanguage(): Lang {
  return i18n.language === "hi" ? "hi" : "en";
}

/** Switch the language now and remember it for the next launch. */
export async function setLanguage(lang: Lang): Promise<void> {
  await i18n.changeLanguage(lang);
  try {
    await AsyncStorage.setItem(LANG_KEY, lang);
  } catch {
    /* the choice still applies until the app closes */
  }
}

/** Apply the language the learner chose last time (before the first screen is drawn). */
export async function loadStoredLanguage(): Promise<void> {
  try {
    const stored = await AsyncStorage.getItem(LANG_KEY);
    if ((stored === "hi" || stored === "en") && stored !== currentLanguage()) await i18n.changeLanguage(stored);
  } catch {
    /* no stored choice: the phone's language stays */
  }
}

/* eslint-enable import/no-named-as-default-member */

export default i18n;
