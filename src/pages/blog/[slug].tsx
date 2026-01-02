import Terminal from "@/components/Terminal";
import { FileNode } from "@/types/files";
import { readDirectory, readTranslations, AllTranslations } from "@/utils/listFiles";
import { GetStaticPaths, GetStaticProps, NextPage } from "next";
import { homeContext } from "..";
import Head from "next/head";
import fs from "fs";
import path from "path";

interface BlogMeta {
  title: string;
  description: string;
  image: string;
}

interface BlogProps {
  allFileNode: FileNode;
  translations: AllTranslations;
  slug: string;
  meta: BlogMeta;
}

const extractBlogMeta = (content: string, slug: string): BlogMeta => {
  // Extract title from first h1
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : slug;

  // Extract description from first paragraph (non-heading, non-empty line)
  const lines = content.split('\n');
  let description = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('!') && !trimmed.startsWith('-') && !trimmed.startsWith('|')) {
      description = trimmed.slice(0, 160);
      break;
    }
  }

  // Extract first image
  const imageMatch = content.match(/!\[.*?\]\((.+?)\)/);
  const image = imageMatch ? imageMatch[1] : '/og-default.png';

  return { title, description, image };
};

export const getStaticPaths: GetStaticPaths = async () => {
  const blogDir = path.join(process.cwd(), 'public/terminal/blog');

  let paths: { params: { slug: string } }[] = [];

  if (fs.existsSync(blogDir)) {
    const files = fs.readdirSync(blogDir);
    paths = files
      .filter(file => file.endsWith('.md'))
      .map(file => ({
        params: { slug: file.replace('.md', '') }
      }));
  }

  return {
    paths,
    fallback: false,
  };
};

export const getStaticProps: GetStaticProps<BlogProps> = async ({ params }) => {
  const allFileNode = readDirectory('public/terminal');
  const translations = readTranslations();
  const slug = params?.slug as string;

  // Read markdown content to extract meta
  const filePath = path.join(process.cwd(), 'public/terminal/blog', `${slug}.md`);
  const content = fs.readFileSync(filePath, 'utf-8');
  const meta = extractBlogMeta(content, slug);

  return {
    props: {
      allFileNode,
      translations,
      slug,
      meta,
    },
  };
};

const BlogPage: NextPage<BlogProps> = ({ allFileNode, translations, slug, meta }) => {
  const filePath = `blog/${slug}.md`;

  const baseUrl = 'https://nikkdev.com';
  const pageUrl = `${baseUrl}/blog/${slug}`;
  const imageUrl = meta.image.startsWith('http') ? meta.image : `${baseUrl}${meta.image}`;

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
      <homeContext.Provider value={{ allFileNode, translations, bookmarks: [] }}>
        <Terminal initialCommand={`cat ${filePath}`} />
      </homeContext.Provider>
    </>
  );
};

export default BlogPage;
