import { createContext, useContext } from "react";
import { DefaultTheme } from "@/components/styles/Themes.styled";

export const ThemeContext = createContext<
  ((switchTheme: DefaultTheme) => void) | null
>(null);

export const useThemeContext = () => {
  const context = useContext(ThemeContext);
  return context;
};
