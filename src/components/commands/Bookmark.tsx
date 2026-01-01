import { useContext, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import styled from "styled-components";
import { getCurrentCmdArry } from "../../utils/funcs";
import {
  BookmarkContainer,
  BookmarkDesc,
  BookmarkIntro,
  BookmarkTitle,
  BookmarkUrl,
  BookmarkAnnotation,
  BookmarkProgressContainer,
  BookmarkProgressBar,
  BookmarkProgressFill,
  BookmarkProgressText,
  LoadingContainer,
  ProgressBar,
  ProgressFill,
  ProgressText,
  FavouriteIndicator,
} from "../styles/Bookmark.styled";
import { termContext } from "../Terminal";
import { UsageDiv } from "../styles/Output.styled";
import { fetchBookmarkManifest, fetchBookmarkContent, fetchAllEnrichedBookmarks, EnrichedBookmark } from "../../utils/bookmarkService";
import type { BookmarkManifest, Annotation } from "../../types/bookmark";

// Insert annotation highlights with speech bubble notes into markdown (FILO order)
function insertAnnotationHighlights(markdown: string, annotations: Annotation[]): string {
  if (!annotations || annotations.length === 0) return markdown;

  const sorted = [...annotations].sort((a, b) => b.startOffset - a.startOffset);

  let result = markdown;
  for (const ann of sorted) {
    const { startOffset, endOffset, note } = ann;
    if (startOffset < 0 || endOffset > result.length || startOffset >= endOffset) continue;

    // Create speech bubble if there's a note
    const bubble = note
      ? `<div class="annotation-bubble"><span class="annotation-bubble-arrow"></span>${note.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`
      : '';

    // Insert highlight with bubble underneath
    result = result.slice(0, endOffset) + '</mark>' + bubble + result.slice(endOffset);
    result = result.slice(0, startOffset) + '<mark class="annotation-highlight">' + result.slice(startOffset);
  }
  return result;
}

// Insert reading progress line marker at scroll percentage position
function insertReadingProgressMarker(markdown: string, scrollPercentage: number): string {
  if (scrollPercentage <= 0 || scrollPercentage >= 100) return markdown;

  const position = Math.floor(markdown.length * (scrollPercentage / 100));
  const lineBreak = markdown.indexOf('\n', position);
  const insertAt = lineBreak !== -1 ? lineBreak : position;

  return markdown.slice(0, insertAt) + '\n\n<div class="reading-progress-marker">👀 Nikk is currently reading here</div>\n' + markdown.slice(insertAt);
}

const MarkdownWrapper = styled.div`
  margin: 0.5rem auto 1rem;
  line-height: 1.75;
  max-width: 80ch;

  h1, h2, h3, h4, h5, h6 {
    color: ${({ theme }) => theme.colors.primary};
    margin: 1.5rem 0 0.75rem 0;
    font-weight: 600;
    line-height: 1.3;
  }

  h1 {
    font-size: 1.75rem;
    border-bottom: 1px solid ${({ theme }) => theme.colors.text[300]};
    padding-bottom: 0.5rem;
  }
  h2 {
    font-size: 1.4rem;
    border-bottom: 1px solid ${({ theme }) => theme.colors.text[300]}50;
    padding-bottom: 0.35rem;
  }
  h3 { font-size: 1.15rem; }
  h4 { font-size: 1rem; }

  p {
    margin: 0.75rem 0;
    color: ${({ theme }) => theme.colors.text[100]};
  }

  a {
    color: ${({ theme }) => theme.colors.secondary};
    text-decoration: none;
    border-bottom: 1px dashed ${({ theme }) => theme.colors.secondary}80;
    transition: border-bottom-color 0.2s ease;

    &:hover {
      border-bottom-color: ${({ theme }) => theme.colors.secondary};
    }
  }

  code {
    background: ${({ theme }) => theme.colors.text[300]}30;
    color: ${({ theme }) => theme.colors.primary};
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    font-family: inherit;
    font-size: 0.9em;
  }

  pre {
    background: ${({ theme }) => theme.colors.text[300]}20;
    border-left: 3px solid ${({ theme }) => theme.colors.secondary};
    padding: 1rem;
    border-radius: 0 4px 4px 0;
    overflow-x: auto;
    margin: 1rem 0;
    line-height: 1.5;

    code {
      background: transparent;
      color: ${({ theme }) => theme.colors.text[100]};
      padding: 0;
    }
  }

  ul, ol {
    margin: 0.75rem 0;
    padding-left: 1.75rem;
  }

  li {
    margin: 0.4rem 0;

    &::marker {
      color: ${({ theme }) => theme.colors.secondary};
    }
  }

  blockquote {
    border-left: 4px solid ${({ theme }) => theme.colors.primary};
    margin: 1rem 0;
    padding: 0.5rem 0 0.5rem 1.25rem;
    color: ${({ theme }) => theme.colors.text[200]};
    background: ${({ theme }) => theme.colors.text[300]}15;
    border-radius: 0 4px 4px 0;
    font-style: italic;
  }

  table {
    border-collapse: collapse;
    margin: 1rem 0;
    width: 100%;
    overflow-x: auto;
    display: block;
  }

  th, td {
    border: 1px solid ${({ theme }) => theme.colors.text[300]}60;
    padding: 0.6rem 0.8rem;
    text-align: left;
  }

  th {
    background: ${({ theme }) => theme.colors.text[300]}25;
    color: ${({ theme }) => theme.colors.primary};
    font-weight: 600;
  }

  tr:nth-child(even) {
    background: ${({ theme }) => theme.colors.text[300]}10;
  }

  img {
    max-width: 100%;
    height: auto;
    margin: 1rem 0;
    border-radius: 4px;
    border: 1px solid ${({ theme }) => theme.colors.text[300]}40;
  }

  strong {
    color: ${({ theme }) => theme.colors.primary};
    font-weight: 600;
  }

  em {
    color: ${({ theme }) => theme.colors.text[200]};
  }

  hr {
    border: none;
    border-top: 1px solid ${({ theme }) => theme.colors.text[300]}50;
    margin: 1.5rem 0;
  }

  mark.annotation-highlight {
    background: ${({ theme }) => theme.colors.secondary}40;
    color: inherit;
    padding: 0.1rem 0.2rem;
    border-radius: 2px;
  }

  .annotation-bubble {
    position: relative;
    background: ${({ theme }) => theme.colors.text[300]}25;
    border-left: 3px solid ${({ theme }) => theme.colors.secondary};
    border-radius: 0 4px 4px 0;
    padding: 0.5rem 0.75rem;
    margin: 0.5rem 0;
    font-size: 0.9rem;
    color: ${({ theme }) => theme.colors.primary};
    font-style: italic;
  }

  .annotation-bubble-arrow {
    position: absolute;
    top: -6px;
    left: 12px;
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-bottom: 6px solid ${({ theme }) => theme.colors.text[300]}25;
  }

  .reading-progress-marker {
    text-align: center;
    padding: 0.75rem 1rem;
    margin: 1.5rem 0;
    color: ${({ theme }) => theme.colors.secondary};
    font-weight: 600;
    font-size: 0.95rem;
    background: ${({ theme }) => theme.colors.secondary}15;
    border: 2px solid ${({ theme }) => theme.colors.secondary}60;
    border-radius: 6px;
  }
`;

type LoadingState = 'idle' | 'loading' | 'success' | 'error';

interface BookmarkState {
  manifest: BookmarkManifest | null;
  manifestLoading: LoadingState;
  content: string | null;
  contentLoading: LoadingState;
  error: string | null;
  enrichedData: Map<string, EnrichedBookmark>;
  enrichedLoading: LoadingState;
}

const Bookmark: React.FC = () => {
  const { arg, history, rerender, index } = useContext(termContext);
  const contentRef = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);
  const [progress, setProgress] = useState(0);

  const [state, setState] = useState<BookmarkState>({
    manifest: null,
    manifestLoading: 'idle',
    content: null,
    contentLoading: 'idle',
    error: null,
    enrichedData: new Map(),
    enrichedLoading: 'idle',
  });

  const currentCommand = getCurrentCmdArry(history);

  // Load manifest on mount
  useEffect(() => {
    if (state.manifestLoading !== 'idle') return;

    setState(prev => ({ ...prev, manifestLoading: 'loading' }));
    setProgress(10);

    fetchBookmarkManifest()
      .then(manifest => {
        setProgress(100);
        setState(prev => ({
          ...prev,
          manifest,
          manifestLoading: 'success',
        }));
      })
      .catch(() => {
        setProgress(100);
        setState(prev => ({
          ...prev,
          manifestLoading: 'error',
          error: 'Failed to load bookmarks',
        }));
      });
  }, [state.manifestLoading]);

  // Load enriched data (progress + annotations) after manifest is loaded
  useEffect(() => {
    if (state.manifestLoading !== 'success' || !state.manifest) return;
    if (state.enrichedLoading !== 'idle') return;

    setState(prev => ({ ...prev, enrichedLoading: 'loading' }));

    fetchAllEnrichedBookmarks(state.manifest.bookmarks)
      .then(enrichedData => {
        setState(prev => ({
          ...prev,
          enrichedData,
          enrichedLoading: 'success',
        }));
      })
      .catch(() => {
        // Silently fail - enriched data is optional
        setState(prev => ({
          ...prev,
          enrichedLoading: 'error',
        }));
      });
  }, [state.manifestLoading, state.manifest, state.enrichedLoading]);

  // Simulate progress animation
  useEffect(() => {
    if (state.manifestLoading === 'loading' || state.contentLoading === 'loading') {
      const interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 90) return prev;
          return prev + Math.random() * 15;
        });
      }, 200);
      return () => clearInterval(interval);
    }
  }, [state.manifestLoading, state.contentLoading]);

  // Load content when 'cat' command is used
  useEffect(() => {
    if (arg[0] !== 'cat' || !arg[1] || !state.manifest) return;
    if (state.contentLoading !== 'idle') return;

    const bookmarkId = parseInt(arg[1]);
    const bookmark = state.manifest.bookmarks.find(b => b.id === bookmarkId);

    if (!bookmark) return;

    setState(prev => ({ ...prev, contentLoading: 'loading' }));
    setProgress(10);

    fetchBookmarkContent(bookmark.key)
      .then(markdown => {
        setProgress(100);
        setState(prev => ({
          ...prev,
          content: markdown,
          contentLoading: 'success',
        }));
      })
      .catch(() => {
        setProgress(100);
        setState(prev => ({
          ...prev,
          contentLoading: 'error',
          error: 'Failed to load bookmark',
        }));
      });
  }, [arg, state.manifest, state.contentLoading]);

  // Handle 'go' action - open URL in new tab
  useEffect(() => {
    if (
      rerender &&
      currentCommand[0] === "bookmark" &&
      currentCommand[1] === "go" &&
      currentCommand.length === 3 &&
      state.manifest
    ) {
      const bookmarkId = parseInt(currentCommand[2]);
      const bookmark = state.manifest.bookmarks.find(b => b.id === bookmarkId);
      if (bookmark?.url) {
        window.open(bookmark.url, "_blank");
      }
    }
  }, [arg, rerender, currentCommand, state.manifest]);

  // Scroll to content when viewing markdown
  useEffect(() => {
    if (index === 0 && contentRef.current && !hasScrolled.current && arg[0] === "cat" && state.contentLoading === 'success') {
      hasScrolled.current = true;
      setTimeout(() => {
        contentRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
      }, 50);
    }
  }, [index, arg, state.contentLoading]);

  // Loading state for manifest
  if (state.manifestLoading === 'loading') {
    return (
      <LoadingContainer>
        <ProgressText>Loading bookmarks...</ProgressText>
        <ProgressBar>
          <ProgressFill style={{ width: `${Math.min(progress, 100)}%` }} />
        </ProgressBar>
      </LoadingContainer>
    );
  }

  // Error state
  if (state.manifestLoading === 'error' || (state.contentLoading === 'error' && arg[0] === 'cat')) {
    return <UsageDiv>{state.error || 'Failed to load bookmark'}</UsageDiv>;
  }

  // No manifest yet
  if (!state.manifest) {
    return null;
  }

  const { manifest } = state;
  const validIds = manifest.bookmarks.map(b => String(b.id));

  // No bookmarks available
  if (manifest.bookmarks.length === 0) {
    return <div>No bookmarks available.</div>;
  }

  // Handle 'cat' action - display full markdown content
  if (arg[0] === "cat" && arg[1]) {
    const bookmarkId = parseInt(arg[1]);
    const bookmark = manifest.bookmarks.find(b => b.id === bookmarkId);

    if (!bookmark) {
      return <UsageDiv>bookmark: {arg[1]}: No such bookmark</UsageDiv>;
    }

    // Loading content
    if (state.contentLoading === 'loading') {
      return (
        <LoadingContainer>
          <ProgressText>Fetching bookmark...</ProgressText>
          <ProgressBar>
            <ProgressFill style={{ width: `${Math.min(progress, 100)}%` }} />
          </ProgressBar>
        </LoadingContainer>
      );
    }

    // Content loaded
    if (state.content) {
      const enriched = state.enrichedData.get(bookmark.key);
      const isFavourite = enriched?.progress?.isFavourite;
      const isRead = enriched?.progress?.isRead;
      const scrollPercentage = enriched?.progress?.scrollPercentage || 0;
      const annotations = enriched?.annotations || [];

      // Process markdown with annotations and progress marker
      let processedContent = state.content;
      processedContent = insertAnnotationHighlights(processedContent, annotations);
      if (!isRead && scrollPercentage > 0) {
        processedContent = insertReadingProgressMarker(processedContent, scrollPercentage);
      }

      return (
        <MarkdownWrapper ref={contentRef}>
          {isFavourite && (
            <FavouriteIndicator>★ Nikk liked this article</FavouriteIndicator>
          )}
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
          >
            {processedContent}
          </ReactMarkdown>
        </MarkdownWrapper>
      );
    }

    return null;
  }

  // Validate arguments
  if (arg.length > 0) {
    const action = arg[0];
    const id = arg[1];

    if ((action !== "go" && action !== "cat") || !id || !validIds.includes(id)) {
      return (
        <UsageDiv data-testid="bookmark-invalid-arg">
          Usage: bookmark cat &lt;id&gt; - view bookmark content
          <br />
          Usage: bookmark go &lt;id&gt; - open bookmark URL
          <br />
          eg: bookmark cat 1
        </UsageDiv>
      );
    }
    return null;
  }

  // Default: list all bookmarks
  return (
    <div data-testid="bookmark">
      <BookmarkIntro>
        Saved articles from the web. Use &apos;go&apos; to open or &apos;cat&apos; to read.
      </BookmarkIntro>
      {manifest.bookmarks.map(({ id, key, title, description, url }) => {
        const enriched = state.enrichedData.get(key);
        const readingProgress = enriched?.progress?.scrollPercentage;
        const firstAnnotation = enriched?.annotations?.[0];
        const annotationCount = enriched?.annotations?.length || 0;

        return (
          <BookmarkContainer key={id}>
            <BookmarkTitle>{`${id}. ${title}`}</BookmarkTitle>
            <BookmarkDesc>{description}</BookmarkDesc>
            <BookmarkUrl href={url} target="_blank" rel="noopener noreferrer">
              {url}
            </BookmarkUrl>
            {firstAnnotation && (
              <BookmarkAnnotation>
                {annotationCount > 1
                  ? `"${firstAnnotation.selectedText}" (+${annotationCount - 1} more)`
                  : `"${firstAnnotation.selectedText}"`}
                {firstAnnotation.note && ` — ${firstAnnotation.note}`}
              </BookmarkAnnotation>
            )}
            {readingProgress !== undefined && (
              <BookmarkProgressContainer>
                <BookmarkProgressBar>
                  <BookmarkProgressFill $progress={readingProgress} />
                </BookmarkProgressBar>
                <BookmarkProgressText>
                  {enriched?.progress?.isRead ? 'Finished' : `${Math.round(readingProgress)}% read`}
                </BookmarkProgressText>
              </BookmarkProgressContainer>
            )}
          </BookmarkContainer>
        );
      })}
      <UsageDiv marginY>
        Usage: bookmark cat &lt;id&gt; | bookmark go &lt;id&gt;
        <br />
        eg: bookmark cat 1
      </UsageDiv>
    </div>
  );
};

export default Bookmark;
