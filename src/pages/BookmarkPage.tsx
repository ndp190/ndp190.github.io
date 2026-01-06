import { useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Terminal from '@/components/Terminal';
import { useHomeContext } from '@/contexts';

interface BookmarkMeta {
  title: string;
  description: string;
  image: string;
}

const updateMetaTags = (meta: BookmarkMeta, bookmarkId: string) => {
  const baseUrl = 'https://nikkdev.com';
  const pageUrl = `${baseUrl}/bookmark/${bookmarkId}`;
  const imageUrl = `${baseUrl}${meta.image}`;

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

const BookmarkPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { bookmarks } = useHomeContext();
  const [ready, setReady] = useState(false);

  // Find bookmark by ID
  const bookmarkId = id ? parseInt(id, 10) : null;
  const bookmark = bookmarkId !== null ? bookmarks.find(b => b.id === bookmarkId) : null;

  useEffect(() => {
    if (!id || !bookmark) return;

    const meta: BookmarkMeta = {
      title: bookmark.title,
      description: (bookmark.description || '').slice(0, 160),
      image: '/og-default.png',
    };
    updateMetaTags(meta, id);

    setReady(true);

    // Restore default title on unmount
    return () => {
      document.title = 'Nikk Terminal';
    };
  }, [id, bookmark]);

  if (!id || !ready || !bookmark) return null;

  return <Terminal initialCommand={`cat bookmarks/${bookmark.key}.md`} />;
};

export default BookmarkPage;
