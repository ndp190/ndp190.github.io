import { useCallback, useEffect, useMemo, useState } from 'react';
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

// Create bookmarks folder node from bookmark manifest
function createBookmarksFolder(bookmarks: BookmarkManifestItem[]): FileNode {
  return {
    name: 'bookmarks',
    path: 'bookmarks',
    isDirectory: true,
    children: bookmarks.map(b => ({
      name: `${b.key}.md`,
      path: `bookmarks/${b.key}.md`,
      isDirectory: false,
      size: 0, // Size unknown until content is fetched
      timestamp: Date.now(),
    })),
  };
}

// Add bookmarks folder to file tree
function addBookmarksToFileTree(fileTree: FileNode, bookmarks: BookmarkManifestItem[]): FileNode {
  if (bookmarks.length === 0) return fileTree;

  const bookmarksFolder = createBookmarksFolder(bookmarks);
  return {
    ...fileTree,
    children: [...(fileTree.children || []), bookmarksFolder],
  };
}

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

  // Merge file tree with bookmarks folder
  const allFileNode = useMemo(() =>
    addBookmarksToFileTree(fileTreeData as FileNode, bookmarks),
    [bookmarks]
  );

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
              allFileNode,
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
