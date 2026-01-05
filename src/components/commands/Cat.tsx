import { useContext, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styled from "styled-components";
import { termContext } from "../Terminal";
import { useHomeContext, useLanguageContext } from "@/contexts";
import { findFileByPath } from "@/utils/fileUtils";
import { UsageDiv } from "../styles/Output.styled";

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
`;

const ErrorMessage = styled.div`
  color: ${({ theme }) => theme.colors.text[300]};
  margin-top: 0.25rem;
  margin-bottom: 0.75rem;
`;

const Cat: React.FC = () => {
  const { arg, index } = useContext(termContext);
  const { allFileNode, translations } = useHomeContext();
  const { language } = useLanguageContext();
  const contentRef = useRef<HTMLDivElement>(null);
  const hasScrolled = useRef(false);

  // Scroll to the top of the content when cat command is first executed
  // Only scroll when this is the most recent command (index === 0)
  // hasScrolled ref prevents scrolling again on re-renders
  useEffect(() => {
    if (index === 0 && contentRef.current && !hasScrolled.current) {
      hasScrolled.current = true;
      setTimeout(() => {
        contentRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
      }, 50);
    }
  }, [index]);

  // Check if file path is provided
  if (arg.length === 0) {
    return <UsageDiv>Usage: cat &lt;file&gt;</UsageDiv>;
  }

  const filePath = arg[0];

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
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {content}
      </ReactMarkdown>
    </MarkdownWrapper>
  );
};

export default Cat;
