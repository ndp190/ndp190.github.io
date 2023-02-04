import { useEffect, useState } from "react";
import themes from "../components/styles/themes";
import { DefaultTheme } from "styled-components";
import { getFromLS, setToLS } from "./storage";

export const useTheme = () => {
  const [theme, setTheme] = useState<DefaultTheme>(themes.dark);
  const [themeLoaded, setThemeLoaded] = useState(false);

  const setMode = (mode: DefaultTheme) => {
    setToLS("tsn-theme", mode.name);
    setTheme(mode);
  };

  useEffect(() => {
    const localThemeName = getFromLS("tsn-theme");
    localThemeName ? setTheme(themes[localThemeName]) : setTheme(themes.nikk);
    setThemeLoaded(true);
  }, []);

  return { theme, themeLoaded, setMode };
};
