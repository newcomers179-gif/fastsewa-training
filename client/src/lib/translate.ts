/**
 * What the app needs from i18next, as plain types, so the helpers below run under `node --test`
 * without loading React Native.
 */
export type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * "1 lesson" / "5 lessons": picks `<key>_one` or `<key>_other` and fills in `{{n}}`.
 *
 * i18next can do this itself when given `count`, but that relies on `Intl.PluralRules`, which the
 * Hermes engine on some phones does not have; a missing rule would print the raw key. Choosing the
 * form here has no such dependency. Hindi uses the same wording for both forms, so `_one` and
 * `_other` are simply identical there. client/tests/i18n.test.ts checks both exist in both languages.
 */
export function countText(t: Translate, key: string, n: number): string {
  return t(`${key}_${n === 1 ? "one" : "other"}`, { n });
}
