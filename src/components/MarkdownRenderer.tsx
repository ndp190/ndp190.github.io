import { useMemo, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import styled from "styled-components";
import "katex/dist/katex.min.css";
import Mermaid from "./Mermaid";

export const MarkdownWrapper = styled.div`
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

  /* KaTeX math styling */
  .katex-display {
    overflow-x: auto;
    overflow-y: hidden;
    padding: 0.5rem 0;
  }

  .katex {
    font-size: 1.1em;
  }

  /* Annotation highlighting */
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

  /* Original article link styling */
  .original-article-link {
    display: block;
    margin-bottom: 1.5rem;
    padding: 0.75rem 1rem;
    background: ${({ theme }) => theme.colors.text[300]}15;
    border-radius: 4px;
    border-left: 3px solid ${({ theme }) => theme.colors.secondary};
    font-size: 0.9rem;

    a {
      word-break: break-all;
    }
  }
`;

interface MarkdownRendererProps {
  content: string;
  allowHtml?: boolean;
}

const MarkdownRenderer: React.FC<MarkdownRendererProps> = memo(({ content, allowHtml = false }) => {
  const rehypePlugins = useMemo(
    () => (allowHtml ? [rehypeKatex, rehypeRaw] : [rehypeKatex]),
    [allowHtml]
  );

  const remarkPlugins = useMemo(() => [remarkGfm, remarkMath], []);

  const components = useMemo(
    () => ({
      code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
        const match = /language-(\w+)/.exec(className || '');
        const language = match ? match[1] : '';

        // Render mermaid diagrams
        if (language === 'mermaid') {
          const chart = String(children).replace(/\n$/, '');
          return <Mermaid chart={chart} />;
        }

        // Regular code blocks
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
    }),
    []
  );

  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {content}
    </ReactMarkdown>
  );
});

MarkdownRenderer.displayName = 'MarkdownRenderer';

export default MarkdownRenderer;
