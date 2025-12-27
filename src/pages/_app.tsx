import GlobalStyle from '@/components/styles/GlobalStyle';
import { DefaultTheme } from '@/components/styles/Themes.styled';
import '@/styles/globals.css'
import { useTheme } from '@/utils/useTheme';
import { useLanguage, Language } from '@/utils/useLanguage';
import type { AppProps } from 'next/app'
import { createContext, useEffect, useState } from 'react';
import { ThemeProvider } from 'styled-components';

export const themeContext = createContext<
  ((switchTheme: DefaultTheme) => void) | null
>(null);

export const languageContext = createContext<{
  language: Language;
  setLanguage: (lang: Language) => void;
}>({
  language: "en",
  setLanguage: () => {},
});

export default function App({ Component, pageProps }: AppProps) {
  // themes
  const { theme, themeLoaded, setMode } = useTheme();
  const [selectedTheme, setSelectedTheme] = useState(theme);

  // language
  const { language, languageLoaded, setLang } = useLanguage();
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(language);

  // Disable browser's default behavior
  // to prevent the page go up when Up Arrow is pressed
  useEffect(() => {
    window.addEventListener(
      "keydown",
      e => {
        ["ArrowUp", "ArrowDown"].indexOf(e.code) > -1 && e.preventDefault();
      },
      false
    );
  }, []);

  useEffect(() => {
    setSelectedTheme(theme);
  }, [themeLoaded]);

  useEffect(() => {
    setSelectedLanguage(language);
  }, [languageLoaded]);

  // Update meta tag colors when switching themes
  useEffect(() => {
    const themeColor = theme.colors?.body;

    const metaThemeColor = document.querySelector("meta[name='theme-color']");
    const maskIcon = document.querySelector("link[rel='mask-icon']");
    const metaMsTileColor = document.querySelector(
      "meta[name='msapplication-TileColor']"
    );

    metaThemeColor && metaThemeColor.setAttribute("content", themeColor);
    metaMsTileColor && metaMsTileColor.setAttribute("content", themeColor);
    maskIcon && maskIcon.setAttribute("color", themeColor);
  }, [selectedTheme]);

  const themeSwitcher = (switchTheme: DefaultTheme) => {
    setSelectedTheme(switchTheme);
    setMode(switchTheme);
  };

  const languageSwitcher = (lang: Language) => {
    setSelectedLanguage(lang);
    setLang(lang);
  };

  return (
    <>
      <h1 className="sr-only" aria-label="Terminal Portfolio">
        Terminal Portfolio
      </h1>
      {themeLoaded && languageLoaded && (
        <ThemeProvider theme={selectedTheme}>
          <GlobalStyle />
          <themeContext.Provider value={themeSwitcher}>
            <languageContext.Provider value={{ language: selectedLanguage, setLanguage: languageSwitcher }}>
              <Component {...pageProps} />
            </languageContext.Provider>
          </themeContext.Provider>
        </ThemeProvider>
      )}
    </>
  );
}
