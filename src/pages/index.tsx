import Terminal from "@/components/Terminal";
import { FileNode } from "@/types/files";
import { BookmarkManifestItem } from "@/types/bookmark";
import { readDirectory, readTranslations, AllTranslations } from "@/utils/listFiles";
import { NextPage } from "next";
import { createContext } from "react";
import Head from "next/head";

const MANIFEST_URL = 'https://r2.nikkdev.com/bookmark/manifest.json';

interface HomeProps {
  allFileNode: FileNode;
  translations: AllTranslations;
  bookmarks: BookmarkManifestItem[];
}

export const getStaticProps = async () => {
  const allFileNode = readDirectory('public/terminal');
  const translations = readTranslations();

  // Fetch bookmark manifest at build time
  let bookmarks: BookmarkManifestItem[] = [];
  try {
    const response = await fetch(MANIFEST_URL);
    if (response.ok) {
      const manifest = await response.json();
      bookmarks = manifest.bookmarks || [];
    }
  } catch {
    // Silently fail - bookmarks are optional
  }

  return {
    props: {
      allFileNode,
      translations,
      bookmarks,
    },
  };
};

export const homeContext = createContext<HomeProps>({
  allFileNode: {
    name: '',
    path: '',
    isDirectory: false,
  },
  translations: {},
  bookmarks: [],
});

const Home: NextPage<HomeProps> = ({ allFileNode, translations, bookmarks }) => {
  const baseUrl = 'https://nikkdev.com';

  return (
    <>
      <Head>
        <title>Nikk Terminal | Interactive Portfolio</title>
        <meta name="description" content="Interactive terminal-style portfolio. Type 'help' to get started." />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Nikk Terminal" />
        <meta property="og:description" content="Interactive terminal-style portfolio. Type 'help' to get started." />
        <meta property="og:image" content={`${baseUrl}/og-default.png`} />
        <meta property="og:url" content={baseUrl} />
        <meta property="og:site_name" content="Nikk Terminal" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Nikk Terminal" />
        <meta name="twitter:description" content="Interactive terminal-style portfolio. Type 'help' to get started." />
        <meta name="twitter:image" content={`${baseUrl}/og-default.png`} />
      </Head>
      <homeContext.Provider value={{ allFileNode, translations, bookmarks }}>
        <Terminal />
      </homeContext.Provider>
    </>
  );
}

export default Home;
