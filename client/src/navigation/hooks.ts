import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp, NativeStackScreenProps } from "@react-navigation/native-stack";
import type { AppParamList } from "@/types";

export type AppNavigation = NativeStackNavigationProp<AppParamList>;
export type ScreenProps<Name extends keyof AppParamList> = NativeStackScreenProps<AppParamList, Name>;

export function useAppNavigation(): AppNavigation {
  return useNavigation<AppNavigation>();
}
