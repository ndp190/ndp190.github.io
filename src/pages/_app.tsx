import GlobalStyle from '@/components/styles/GlobalStyle';
import '@/styles/globals.css'
import { useTheme } from '@/utils/useTheme';
import type { AppProps } from 'next/app'
import { createContext, useEffect, useState } from 'react';
import { DefaultTheme, ThemeProvider } from 'styled-components';

// TODO remove later
// export default function App({ Component, pageProps }: AppProps) {
//   return <Component {...pageProps} />
// }

export const themeContext = createContext<
  ((switchTheme: DefaultTheme) => void) | null
>(null);

export default function App({ Component, pageProps }: AppProps) {
  // themes
  const { theme, themeLoaded, setMode } = useTheme();
  const [selectedTheme, setSelectedTheme] = useState(theme);

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

  return (
    <>
      <h1 className="sr-only" aria-label="Terminal Portfolio">
        Terminal Portfolio
      </h1>
      {themeLoaded && (
        <ThemeProvider theme={selectedTheme}>
          <GlobalStyle />
          <themeContext.Provider value={themeSwitcher}>
            <Component {...pageProps} />
          </themeContext.Provider>
        </ThemeProvider>
      )}
    </>
  );
}
