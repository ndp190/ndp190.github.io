import Terminal from "@/components/Terminal";
import { FileNode } from "@/types/files";
import { BookmarkManifest, BookmarkManifestItem } from "@/types/bookmark";
import { readDirectory } from "@/utils/listFiles";
import { GetStaticPaths, GetStaticProps, NextPage } from "next";
import { homeContext } from "..";
import Head from "next/head";
import fs from "fs";
import path from "path";

interface BookmarkMeta {
  title: string;
  description: string;
  image: string;
}

interface BookmarkPageProps {
  allFileNode: FileNode;
  bookmarkId: number;
  meta: BookmarkMeta;
}

// Read manifest at build time
function readManifest(): BookmarkManifest {
  const manifestPath = path.join(process.cwd(), 'public/bookmark/manifest.json');
  const content = fs.readFileSync(manifestPath, 'utf-8');
  return JSON.parse(content);
}

export const getStaticPaths: GetStaticPaths = async () => {
  const manifest = readManifest();

  const paths = manifest.bookmarks.map((bookmark: BookmarkManifestItem) => ({
    params: { slug: String(bookmark.id) }
  }));

  return {
    paths,
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps<BookmarkPageProps> = async ({ params }) => {
  const allFileNode = readDirectory('public/terminal');
  const manifest = readManifest();
  const bookmarkId = parseInt(params?.slug as string, 10);

  const bookmark = manifest.bookmarks.find((b: BookmarkManifestItem) => b.id === bookmarkId);

  if (!bookmark) {
    return { notFound: true };
  }

  const meta: BookmarkMeta = {
    title: bookmark.title,
    description: bookmark.description.slice(0, 160),
    image: '/og-default.png',
  };

  return {
    props: {
      allFileNode,
      bookmarkId,
      meta,
    },
  };
};

const BookmarkPage: NextPage<BookmarkPageProps> = ({ allFileNode, bookmarkId, meta }) => {
  const baseUrl = 'https://nikkdev.com';
  const pageUrl = `${baseUrl}/bookmark/${bookmarkId}`;
  const imageUrl = `${baseUrl}${meta.image}`;

  return (
    <>
      <Head>
        <title>{meta.title} | Nikk Terminal</title>
        <meta name="description" content={meta.description} />

        {/* Open Graph */}
        <meta property="og:type" content="article" />
        <meta property="og:title" content={meta.title} />
        <meta property="og:description" content={meta.description} />
        <meta property="og:image" content={imageUrl} />
        <meta property="og:url" content={pageUrl} />
        <meta property="og:site_name" content="Nikk Terminal" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={meta.title} />
        <meta name="twitter:description" content={meta.description} />
        <meta name="twitter:image" content={imageUrl} />
      </Head>
      <homeContext.Provider value={{ allFileNode }}>
        <Terminal initialCommand={`bookmark cat ${bookmarkId}`} />
      </homeContext.Provider>
    </>
  );
};

export default BookmarkPage;
