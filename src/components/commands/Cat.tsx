import { useContext, useEffect, useRef, useState } from "react";
import styled from "styled-components";
import { termContext } from "../Terminal";
import { useHomeContext, useLanguageContext } from "@/contexts";
import { findFileByPath } from "@/utils/fileUtils";
import { UsageDiv } from "../styles/Output.styled";
import MarkdownRenderer, { MarkdownWrapper } from "../MarkdownRenderer";
import { fetchBookmarkContent } from "@/utils/bookmarkService";
import { FavouriteIndicator } from "../styles/Bookmark.styled";
import type { Annotation } from "@/types/bookmark";

const ErrorMessage = styled.div`
  color: ${({ theme }) => theme.colors.text[300]};
  margin-top: 0.25rem;
  margin-bottom: 0.75rem;
`;

const LoadingMessage = styled.div`
  color: ${({ theme }) => theme.colors.text[200]};
  margin: 0.5rem 0;
`;

// Insert annotation highlights with speech bubble notes into markdown (FILO order)
function insertAnnotationHighlights(markdown: string, annotations: Annotation[]): string {
  if (!annotations || annotations.length === 0) return markdown;

  const sorted = [...annotations].sort((a, b) => b.startOffset - a.startOffset);

  let result = markdown;
  for (const ann of sorted) {
    const { startOffset, endOffset, note } = ann;
    if (startOffset < 0 || endOffset > result.length || startOffset >= endOffset) continue;

    const bubble = note
      ? `<div class="annotation-bubble"><span class="annotation-bubble-arrow"></span>${note.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`
      : '';

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

  return markdown.slice(0, insertAt) + '\n\n<div class="reading-progress-marker">Nikk is currently reading here</div>\n' + markdown.slice(insertAt);
}

const Cat: React.FC = () => {
  const { arg, index } = useContext(termContext);
  const { allFileNode, translations, bookmarks } = useHomeContext();
  const { language } = useLanguageContext();
  const contentRef = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);

  // State for bookmark content loading
  const [bookmarkContent, setBookmarkContent] = useState<string | null>(null);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);
  const [bookmarkError, setBookmarkError] = useState<string | null>(null);

  const filePath = arg[0] || "";
  const isBookmarkPath = filePath.startsWith("bookmarks/");

  // Find bookmark if it's a bookmark path
  const bookmark = isBookmarkPath
    ? bookmarks.find(b => `bookmarks/${b.key}.md` === filePath)
    : null;

  // Load bookmark content
  useEffect(() => {
    if (!bookmark || bookmarkContent !== null || bookmarkLoading) return;

    setBookmarkLoading(true);
    fetchBookmarkContent(bookmark.key)
      .then(content => {
        setBookmarkContent(content);
        setBookmarkLoading(false);
      })
      .catch(() => {
        setBookmarkError("Failed to load bookmark content");
        setBookmarkLoading(false);
      });
  }, [bookmark, bookmarkContent, bookmarkLoading]);

  // Scroll to the top of the content when cat command is first executed
  useEffect(() => {
    if (index === 0 && contentRef.current && !hasScrolled.current) {
      hasScrolled.current = true;
      setTimeout(() => {
        contentRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
      }, 50);
    }
  }, [index, bookmarkContent]);

  // Check if file path is provided
  if (arg.length === 0) {
    return <UsageDiv>Usage: cat &lt;file&gt;</UsageDiv>;
  }

  // Handle bookmark files
  if (isBookmarkPath) {
    if (!bookmark) {
      return <ErrorMessage>cat: {filePath}: No such file or directory</ErrorMessage>;
    }

    if (bookmarkLoading) {
      return <LoadingMessage>Loading bookmark...</LoadingMessage>;
    }

    if (bookmarkError) {
      return <ErrorMessage>cat: {filePath}: {bookmarkError}</ErrorMessage>;
    }

    if (bookmarkContent) {
      const isFavourite = bookmark.progress?.isFavourite;
      const isRead = bookmark.progress?.isRead;
      const scrollPercentage = bookmark.progress?.scrollPercentage || 0;
      const annotations = bookmark.annotations || [];

      // Process markdown with annotations and progress marker
      let processedContent = bookmarkContent;
      processedContent = insertAnnotationHighlights(processedContent, annotations);
      if (!isRead && scrollPercentage > 0) {
        processedContent = insertReadingProgressMarker(processedContent, scrollPercentage);
      }

      // Add original article link at the start
      const originalLink = `<div class="original-article-link">📎 Original: <a href="${bookmark.url}" target="_blank" rel="noopener noreferrer">${bookmark.url}</a></div>\n\n`;

      return (
        <MarkdownWrapper ref={contentRef}>
          {isFavourite && (
            <FavouriteIndicator>* Nikk liked this article</FavouriteIndicator>
          )}
          <MarkdownRenderer content={originalLink + processedContent} allowHtml />
        </MarkdownWrapper>
      );
    }

    return null;
  }

  // Find the file in the file tree
  const file = findFileByPath(allFileNode, filePath);

  if (!file) {
    return <ErrorMessage>cat: {filePath}: No such file or directory</ErrorMessage>;
  }

  if (file.isDirectory) {
    return <ErrorMessage>cat: {filePath}: Is a directory</ErrorMessage>;
  }

  // Get content - check for translation first if not English
  let content = file.content;
  if (language !== "en" && filePath.endsWith(".md")) {
    const translatedContent = translations[language]?.[file.path];
    if (translatedContent) {
      content = translatedContent;
    }
  }

  if (!content) {
    return <ErrorMessage>cat: {filePath}: Unable to read file</ErrorMessage>;
  }

  return (
    <MarkdownWrapper ref={contentRef}>
      <MarkdownRenderer content={content} allowHtml />
    </MarkdownWrapper>
  );
};

export default Cat;
