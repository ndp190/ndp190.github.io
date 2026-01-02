import Terminal from "@/components/Terminal";
import { FileNode } from "@/types/files";
import { readDirectory, readTranslations, AllTranslations } from "@/utils/listFiles";
import { NextPage } from "next";
import { homeContext } from "..";
import Head from "next/head";

interface BookmarkIndexProps {
  allFileNode: FileNode;
  translations: AllTranslations;
}

export const getStaticProps = async () => {
  const allFileNode = readDirectory('public/terminal');
  const translations = readTranslations();

  return {
    props: {
      allFileNode,
      translations,
    },
  };
};

const BookmarkIndex: NextPage<BookmarkIndexProps> = ({ allFileNode, translations }) => {
  const baseUrl = 'https://nikkdev.com';

  return (
    <>
      <Head>
        <title>Bookmarks | Nikk Terminal</title>
        <meta name="description" content="Saved articles from the web. Browse Nikk's reading list." />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Bookmarks | Nikk Terminal" />
        <meta property="og:description" content="Saved articles from the web. Browse Nikk's reading list." />
        <meta property="og:image" content={`${baseUrl}/og-default.png`} />
        <meta property="og:url" content={`${baseUrl}/bookmark`} />
        <meta property="og:site_name" content="Nikk Terminal" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Bookmarks | Nikk Terminal" />
        <meta name="twitter:description" content="Saved articles from the web. Browse Nikk's reading list." />
        <meta name="twitter:image" content={`${baseUrl}/og-default.png`} />
      </Head>
      <homeContext.Provider value={{ allFileNode, translations, bookmarks: [] }}>
        <Terminal initialCommand="bookmark" />
      </homeContext.Provider>
    </>
  );
};

export default BookmarkIndex;
