import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Terminal from '@/components/Terminal';
import { useHomeContext } from '@/contexts';
import { findFileByPath } from '@/utils/fileUtils';

interface BlogMeta {
  title: string;
  description: string;
  image: string;
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

const updateMetaTags = (meta: BlogMeta, slug: string) => {
  const baseUrl = 'https://nikkdev.com';
  const pageUrl = `${baseUrl}/blog/${slug}`;
  const imageUrl = meta.image.startsWith('http') ? meta.image : `${baseUrl}${meta.image}`;

  // Update document title
  document.title = `${meta.title} | Nikk Terminal`;

  // Update or create meta tags
  const updateMeta = (selector: string, attribute: string, content: string) => {
    let element = document.querySelector(selector);
    if (!element) {
      element = document.createElement('meta');
      if (selector.includes('property=')) {
        element.setAttribute('property', selector.match(/property="([^"]+)"/)?.[1] || '');
      } else if (selector.includes('name=')) {
        element.setAttribute('name', selector.match(/name="([^"]+)"/)?.[1] || '');
      }
      document.head.appendChild(element);
    }
    element.setAttribute(attribute, content);
  };

  updateMeta('meta[name="description"]', 'content', meta.description);
  updateMeta('meta[property="og:type"]', 'content', 'article');
  updateMeta('meta[property="og:title"]', 'content', meta.title);
  updateMeta('meta[property="og:description"]', 'content', meta.description);
  updateMeta('meta[property="og:image"]', 'content', imageUrl);
  updateMeta('meta[property="og:url"]', 'content', pageUrl);
  updateMeta('meta[property="og:site_name"]', 'content', 'Nikk Terminal');
  updateMeta('meta[name="twitter:card"]', 'content', 'summary_large_image');
  updateMeta('meta[name="twitter:title"]', 'content', meta.title);
  updateMeta('meta[name="twitter:description"]', 'content', meta.description);
  updateMeta('meta[name="twitter:image"]', 'content', imageUrl);
};

const BlogPost: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const { allFileNode } = useHomeContext();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!slug) return;

    const filePath = `blog/${slug}.md`;
    const file = findFileByPath(allFileNode, filePath);

    if (file?.content) {
      const meta = extractBlogMeta(file.content, slug);
      updateMetaTags(meta, slug);
    }

    setReady(true);

    // Restore default title on unmount
    return () => {
      document.title = 'Nikk Terminal';
    };
  }, [slug, allFileNode]);

  if (!slug || !ready) return null;

  const filePath = `blog/${slug}.md`;
  return <Terminal initialCommand={`cat ${filePath}`} />;
};

export default BlogPost;
