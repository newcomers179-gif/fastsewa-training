import React, { useRef, useState } from "react";
import { Linking, TextInput } from "react-native";
import { useTranslation } from "react-i18next";
import { normalizeUsername } from "@shared/validation";
import { BrandHeader } from "@/components/BrandHeader";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { ThemedText } from "@/components/ThemedText";
import { Banner, Button, Checkbox, FormScroll, Screen, TextField } from "@/components/ui";
import { useAppConfig } from "@/hooks/useAppConfig";
import { useAuth } from "@/hooks/useAuth";
import { errorMessage, fieldErrors, isFieldError } from "@/lib/errors";
import { onlyProblems, validateConfirmation, validateDisplayName, validateEmail, validateNewPassword, validatePhone, validateRequired, validateUsername } from "@/lib/validation";
import type { ScreenProps } from "@/navigation/hooks";

interface Form {
  displayName: string;
  username: string;
  phone: string;
  email: string;
  password: string;
  confirm: string;
  code: string;
  adult: boolean;
  terms: boolean;
}

const EMPTY: Form = { displayName: "", username: "", phone: "", email: "", password: "", confirm: "", code: "", adult: false, terms: false };

export default function RegisterScreen({ navigation }: ScreenProps<"Register">) {
  const { t } = useTranslation();
  const { register } = useAuth();
  const { config } = useAppConfig();
  const [form, setForm] = useState<Form>(EMPTY);
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const usernameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  const set = <K extends keyof Form>(field: K, value: Form[K], problemKey: string = field) => {
    setForm((f) => ({ ...f, [field]: value }));
    setProblems((p) => ({ ...p, [problemKey]: "" }));
  };
  const show = (field: string) => (problems[field] ? problems[field] : undefined);

  const submit = async () => {
    const found = onlyProblems({
      displayName: validateDisplayName(form.displayName),
      username: validateUsername(form.username),
      phoneNumber: validatePhone(form.phone),
      email: validateEmail(form.email),
      password: validateNewPassword(form.password, { username: normalizeUsername(form.username) }),
      confirm: validateConfirmation(form.password, form.confirm),
      ...(config.registrationCodeRequired ? { registrationCode: validateRequired(form.code) } : {}),
      confirmAdult: form.adult ? null : "errors.ADULT_CONFIRMATION_REQUIRED",
      acceptTerms: form.terms ? null : "errors.CONSENT_REQUIRED",
    });
    const translated = Object.fromEntries(Object.entries(found).map(([field, key]) => [field, t(key)]));
    setProblems(translated);
    if (Object.keys(translated).length > 0) return;

    setBusy(true);
    setError(null);
    try {
      await register({
        displayName: form.displayName,
        username: form.username,
        phoneNumber: form.phone,
        email: form.email,
        password: form.password,
        registrationCode: form.code,
        acceptTerms: form.terms,
        confirmAdult: form.adult,
      });
    } catch (e) {
      setProblems(fieldErrors(e, t));
      setError(isFieldError(e) ? null : e);
      setBusy(false);
    }
  };

  const open = (url: string | null) => {
    if (url) void Linking.openURL(url);
  };

  return (
    <Screen edges={["bottom", "left", "right"]}>
      <FormScroll>
        <BrandHeader title={t("auth.register.title")} subtitle={t("auth.register.intro")} />
        <LanguageSwitch />
        {error ? <Banner tone="error">{errorMessage(error, t)}</Banner> : null}

        <TextField label={t("auth.register.name")} hint={t("auth.register.nameHint")} value={form.displayName} onChangeText={(v) => set("displayName", v)} error={show("displayName")} autoComplete="name" textContentType="name" autoCapitalize="words" returnKeyType="next" onSubmitEditing={() => usernameRef.current?.focus()} />
        <TextField ref={usernameRef} label={t("auth.register.username")} hint={t("auth.register.usernameHint")} value={form.username} onChangeText={(v) => set("username", v)} error={show("username")} autoCapitalize="none" autoCorrect={false} autoComplete="username-new" textContentType="username" returnKeyType="next" onSubmitEditing={() => phoneRef.current?.focus()} />
        <TextField ref={phoneRef} label={t("auth.register.phone")} hint={t("auth.register.phoneHint")} optional value={form.phone} onChangeText={(v) => set("phone", v, "phoneNumber")} error={show("phoneNumber")} keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" returnKeyType="next" onSubmitEditing={() => emailRef.current?.focus()} />
        <TextField ref={emailRef} label={t("auth.register.email")} hint={t("auth.register.emailHint")} optional value={form.email} onChangeText={(v) => set("email", v)} error={show("email")} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} />
        <TextField ref={passwordRef} label={t("auth.register.password")} hint={t("auth.register.passwordHint")} value={form.password} onChangeText={(v) => set("password", v)} error={show("password")} secure autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" returnKeyType="next" onSubmitEditing={() => confirmRef.current?.focus()} />
        <TextField ref={confirmRef} label={t("auth.register.confirm")} value={form.confirm} onChangeText={(v) => set("confirm", v, "confirm")} error={show("confirm")} secure autoCapitalize="none" autoCorrect={false} autoComplete="new-password" textContentType="newPassword" returnKeyType={config.registrationCodeRequired ? "next" : "done"} />
        {config.registrationCodeRequired ? <TextField label={t("auth.register.code")} hint={t("auth.register.codeHint")} value={form.code} onChangeText={(v) => set("code", v, "registrationCode")} error={show("registrationCode")} autoCapitalize="none" autoCorrect={false} /> : null}

        <Checkbox checked={form.adult} onChange={(v) => set("adult", v, "confirmAdult")} error={show("confirmAdult")}>
          <ThemedText>{t("auth.register.adult")}</ThemedText>
        </Checkbox>
        <Checkbox checked={form.terms} onChange={(v) => set("terms", v, "acceptTerms")} error={show("acceptTerms")}>
          <ThemedText>
            {t("auth.register.termsBefore")}
            <ThemedText accessibilityRole={config.termsUrl ? "link" : undefined} onPress={config.termsUrl ? () => open(config.termsUrl) : undefined} style={config.termsUrl ? { textDecorationLine: "underline", fontWeight: "700" } : undefined}>
              {t("auth.register.termsLink")}
            </ThemedText>
            {t("auth.register.termsAnd")}
            <ThemedText accessibilityRole={config.privacyPolicyUrl ? "link" : undefined} onPress={config.privacyPolicyUrl ? () => open(config.privacyPolicyUrl) : undefined} style={config.privacyPolicyUrl ? { textDecorationLine: "underline", fontWeight: "700" } : undefined}>
              {t("auth.register.privacyLink")}
            </ThemedText>
            {t("auth.register.termsAfter")}
          </ThemedText>
        </Checkbox>

        <Button variant="ghost" icon={showPrivacy ? "chevron-up" : "info"} label={t("auth.register.whatWeKeepTitle")} onPress={() => setShowPrivacy((s) => !s)} />
        {showPrivacy ? (
          <Banner tone="info" icon="shield">
            <ThemedText type="small">{t("auth.register.whatWeKeep1")}</ThemedText>
            <ThemedText type="small">{t("auth.register.whatWeKeep2")}</ThemedText>
            <ThemedText type="small">{t("auth.register.whatWeKeep3")}</ThemedText>
          </Banner>
        ) : null}

        <Button label={t("auth.register.submit")} onPress={() => void submit()} loading={busy} />
        <Button variant="ghost" label={t("auth.register.haveAccount")} onPress={() => navigation.popTo("Login")} />
      </FormScroll>
    </Screen>
  );
}
