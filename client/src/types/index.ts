/** Everything the screens import as "@/types": the API shapes (api.ts) and the navigation parameter lists. */
import type { NavigatorScreenParams } from "@react-navigation/native";

export * from "./api";

// ─── Navigation ──────────────────────────────────────────────────────────────
export type TabParamList = {
  Learn: undefined;
  Tasks: undefined;
  Profile: undefined;
};

/** One stack for the whole app; which screens exist depends on who is signed in (see navigation/index.tsx). */
export type AppParamList = {
  // signed out
  Login: { notice?: "passwordReset" } | undefined;
  Register: undefined;
  ForgotPassword: undefined;
  ResetPassword: { email: string };
  // signed in
  Tabs: NavigatorScreenParams<TabParamList> | undefined;
  CourseDetail: { courseId: string };
  ModuleDetail: { moduleId: string };
  LessonDetail: { lessonId: string };
  Quiz: { moduleId: string };
  Search: undefined;
  EditProfile: undefined;
  ChangePassword: undefined;
  DeleteAccount: undefined;
  // signed in, but an administrator issued a one-time password: only this screen until a new one is chosen
  ForcedPassword: undefined;
};
