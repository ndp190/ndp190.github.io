import Terminal from "@/components/Terminal";
import { FileNode } from "@/types/files";
import { readDirectory, readTranslations, AllTranslations } from "@/utils/listFiles";
import { NextPage } from "next";
import { homeContext } from "..";
import Head from "next/head";

interface BlogIndexProps {
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

const BlogIndex: NextPage<BlogIndexProps> = ({ allFileNode, translations }) => {
  const baseUrl = 'https://nikkdev.com';

  return (
    <>
      <Head>
        <title>Blog | Nikk Terminal</title>
        <meta name="description" content="Nikk's blog posts. Thoughts, tutorials, and musings." />

        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Blog | Nikk Terminal" />
        <meta property="og:description" content="Nikk's blog posts. Thoughts, tutorials, and musings." />
        <meta property="og:image" content={`${baseUrl}/og-default.png`} />
        <meta property="og:url" content={`${baseUrl}/blog`} />
        <meta property="og:site_name" content="Nikk Terminal" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Blog | Nikk Terminal" />
        <meta name="twitter:description" content="Nikk's blog posts. Thoughts, tutorials, and musings." />
        <meta name="twitter:image" content={`${baseUrl}/og-default.png`} />
      </Head>
      <homeContext.Provider value={{ allFileNode, translations, bookmarks: [] }}>
        <Terminal initialCommand="ls -l blog" />
      </homeContext.Provider>
    </>
  );
};

export default BlogIndex;
