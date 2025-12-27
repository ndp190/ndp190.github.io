import Terminal from "@/components/Terminal";
import { FileNode } from "@/types/files";
import { readDirectory } from "@/utils/listFiles";
import { GetStaticPaths, GetStaticProps, NextPage } from "next";
import { homeContext } from "..";
import fs from "fs";
import path from "path";

interface BlogProps {
  allFileNode: FileNode;
  slug: string;
}

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
  const slug = params?.slug as string;

  return {
    props: {
      allFileNode,
      slug,
    },
  };
};

const BlogPage: NextPage<BlogProps> = ({ allFileNode, slug }) => {
  return (
    <homeContext.Provider value={{ allFileNode }}>
      <Terminal initialCommand={`cat blog/${slug}.md`} />
    </homeContext.Provider>
  );
};

export default BlogPage;
