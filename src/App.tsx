import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from 'styled-components';
import GlobalStyle from '@/components/styles/GlobalStyle';
import { DefaultTheme } from '@/components/styles/Themes.styled';
import { useTheme } from '@/hooks/useTheme';
import { useLanguage, Language } from '@/hooks/useLanguage';
import { ThemeContext, LanguageContext, HomeContext, AllTranslations } from '@/contexts';
import { FileNode } from '@/types/files';
import { BookmarkManifestItem } from '@/types/bookmark';

// Import pages
import Home from '@/pages/Home';
import BlogPost from '@/pages/BlogPost';
import BookmarkPage from '@/pages/BookmarkPage';

// Import generated data
import fileTreeData from '@/data/fileTree.json';
import translationsData from '@/data/translations.json';

const MANIFEST_URL = 'https://r2.nikkdev.com/bookmark/manifest.json';

function App() {
  // Theme state
  const { theme, themeLoaded, setMode } = useTheme();
  const [selectedTheme, setSelectedTheme] = useState(theme);

  // Language state
  const { language, languageLoaded, setLang } = useLanguage();
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(language);

  // Bookmarks state (fetched at runtime)
  const [bookmarks, setBookmarks] = useState<BookmarkManifestItem[]>([]);

  // Fetch bookmarks on mount
  useEffect(() => {
    const fetchBookmarks = async () => {
      try {
        const response = await fetch(MANIFEST_URL);
        if (response.ok) {
          const manifest = await response.json();
          setBookmarks(manifest.bookmarks || []);
        }
      } catch {
        // Silently fail - bookmarks are optional
      }
    };
    fetchBookmarks();
  }, []);

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
  }, [themeLoaded, theme]);

  useEffect(() => {
    setSelectedLanguage(language);
  }, [languageLoaded, language]);

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
  }, [selectedTheme, theme.colors?.body]);

  const themeSwitcher = useCallback((switchTheme: DefaultTheme) => {
    setSelectedTheme(switchTheme);
    setMode(switchTheme);
  }, [setMode]);

  const languageSwitcher = useCallback((lang: Language) => {
    setSelectedLanguage(lang);
    setLang(lang);
  }, [setLang]);

  // Use default theme for initial render, then hydrate with stored theme
  const currentTheme = themeLoaded ? selectedTheme : theme;
  const currentLanguage = languageLoaded ? selectedLanguage : language;

  return (
    <BrowserRouter>
      <h1 className="sr-only" aria-label="Terminal Portfolio">
        Terminal Portfolio
      </h1>
      <ThemeProvider theme={currentTheme}>
        <GlobalStyle />
        <ThemeContext.Provider value={themeSwitcher}>
          <LanguageContext.Provider value={{ language: currentLanguage, setLanguage: languageSwitcher }}>
            <HomeContext.Provider value={{
              allFileNode: fileTreeData as FileNode,
              translations: translationsData as AllTranslations,
              bookmarks
            }}>
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/blog/:slug" element={<BlogPost />} />
                <Route path="/bookmark/:id" element={<BookmarkPage />} />
              </Routes>
            </HomeContext.Provider>
          </LanguageContext.Provider>
        </ThemeContext.Provider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

export default App;
