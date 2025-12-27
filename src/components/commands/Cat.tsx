import { useContext } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styled from "styled-components";
import { termContext } from "../Terminal";
import { homeContext } from "@/pages";
import { findFileByPath } from "@/utils/fileUtils";
import { UsageDiv } from "../styles/Output.styled";

const MarkdownWrapper = styled.div`
  margin-top: 0.25rem;
  margin-bottom: 0.75rem;
  line-height: 1.6;

  h1, h2, h3, h4, h5, h6 {
    color: ${({ theme }) => theme.colors.primary};
    margin: 1rem 0 0.5rem 0;
  }

  h1 { font-size: 1.5rem; }
  h2 { font-size: 1.25rem; }
  h3 { font-size: 1.1rem; }

  p {
    margin: 0.5rem 0;
  }

  a {
    color: ${({ theme }) => theme.colors.secondary};
    text-decoration: underline;
  }

  code {
    background: ${({ theme }) => theme.colors.body};
    border: 1px solid ${({ theme }) => theme.colors.text[300]};
    padding: 0.1rem 0.3rem;
    border-radius: 3px;
    font-family: inherit;
  }

  pre {
    background: ${({ theme }) => theme.colors.body};
    border: 1px solid ${({ theme }) => theme.colors.text[300]};
    padding: 0.75rem;
    border-radius: 4px;
    overflow-x: auto;
    margin: 0.5rem 0;

    code {
      border: none;
      padding: 0;
    }
  }

  ul, ol {
    margin: 0.5rem 0;
    padding-left: 1.5rem;
  }

  li {
    margin: 0.25rem 0;
  }

  blockquote {
    border-left: 3px solid ${({ theme }) => theme.colors.primary};
    margin: 0.5rem 0;
    padding-left: 1rem;
    color: ${({ theme }) => theme.colors.text[200]};
  }

  table {
    border-collapse: collapse;
    margin: 0.5rem 0;
  }

  th, td {
    border: 1px solid ${({ theme }) => theme.colors.text[300]};
    padding: 0.5rem;
  }

  th {
    background: ${({ theme }) => theme.colors.body};
    color: ${({ theme }) => theme.colors.primary};
  }

  img {
    max-width: 100%;
    height: auto;
    margin: 0.5rem 0;
    border-radius: 4px;
  }

  strong {
    color: ${({ theme }) => theme.colors.primary};
  }

  hr {
    border: none;
    border-top: 1px solid ${({ theme }) => theme.colors.text[300]};
    margin: 1rem 0;
  }
`;

const ErrorMessage = styled.div`
  color: ${({ theme }) => theme.colors.text[300]};
  margin-top: 0.25rem;
  margin-bottom: 0.75rem;
`;

const Cat: React.FC = () => {
  const { arg } = useContext(termContext);
  const { allFileNode } = useContext(homeContext);

  // Check if file path is provided
  if (arg.length === 0) {
    return <UsageDiv>Usage: cat &lt;file&gt;</UsageDiv>;
  }

  const filePath = arg[0];
  const file = findFileByPath(allFileNode, filePath);

  if (!file) {
    return <ErrorMessage>cat: {filePath}: No such file or directory</ErrorMessage>;
  }

  if (file.isDirectory) {
    return <ErrorMessage>cat: {filePath}: Is a directory</ErrorMessage>;
  }

  if (!file.content) {
    return <ErrorMessage>cat: {filePath}: Unable to read file</ErrorMessage>;
  }

  return (
    <MarkdownWrapper>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>
        {file.content}
      </ReactMarkdown>
    </MarkdownWrapper>
  );
};

export default Cat;
