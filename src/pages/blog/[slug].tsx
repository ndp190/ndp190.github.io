import Terminal from "@/components/Terminal";
import { FileNode } from "@/types/files";
import { readDirectory } from "@/utils/listFiles";
import { GetStaticPaths, GetStaticProps, NextPage } from "next";
import { homeContext } from "..";
import { languageContext } from "@/pages/_app";
import { Language } from "@/utils/useLanguage";
import Head from "next/head";
import { useRouter } from "next/router";
import { useContext, useEffect } from "react";
import fs from "fs";
import path from "path";

interface BlogMeta {
  title: string;
  description: string;
  image: string;
}

interface BlogProps {
  allFileNode: FileNode;
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
  const rawSlug = params?.slug as string;

  // Handle Vietnamese slugs (e.g., hello-world.vn -> hello-world.vn.md)
  const isVietnamese = rawSlug.endsWith('.vn');
  const baseSlug = isVietnamese ? rawSlug.slice(0, -3) : rawSlug;
  const fileName = isVietnamese ? `${baseSlug}.vn.md` : `${rawSlug}.md`;

  // Read markdown content to extract meta
  const filePath = path.join(process.cwd(), 'public/terminal/blog', fileName);
  const content = fs.readFileSync(filePath, 'utf-8');
  const meta = extractBlogMeta(content, baseSlug);

  return {
    props: {
      allFileNode,
      slug: rawSlug,
      meta,
    },
  };
};

const BlogPage: NextPage<BlogProps> = ({ allFileNode, slug, meta }) => {
  const router = useRouter();
  const { setLanguage } = useContext(languageContext);

  // Handle Vietnamese slugs for file path
  const isVietnamese = slug.endsWith('.vn');
  const baseSlug = isVietnamese ? slug.slice(0, -3) : slug;
  const filePath = isVietnamese ? `blog/${baseSlug}.vn.md` : `blog/${slug}.md`;

  // Set language from query parameter or slug
  useEffect(() => {
    const langParam = router.query.language as string | undefined;
    if (langParam === "vn" || langParam === "en") {
      setLanguage(langParam as Language);
    } else if (isVietnamese) {
      setLanguage("vn");
    }
  }, [router.query.language, setLanguage, isVietnamese]);

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
      <homeContext.Provider value={{ allFileNode }}>
        <Terminal initialCommand={`cat ${filePath}`} />
      </homeContext.Provider>
    </>
  );
};

export default BlogPage;
