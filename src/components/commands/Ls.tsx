import { homeContext } from "@/pages";
import { FileNode } from "@/types/files";
import React, { useContext } from "react";
import { Wrapper } from "../styles/Output.styled";
import { termContext } from "../Terminal";
import { findFileByPath } from "@/utils/fileUtils";
import styled from "styled-components";

const ErrorMessage = styled.div`
  color: ${({ theme }) => theme.colors.text[300]};
`;

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  return date.toLocaleString('en-US', options).replace(',', '');
}

function formatFileSize(size: number): string {
  const units = ["B", "K", "M", "G", "T"];
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  if (index === 0) {
    return `${size.toString().padStart(4, ' ')}`;
  }
  return `${size.toFixed(1).padStart(4, ' ')}${units[index]}`;
}

function renderSimpleList(node: FileNode): string {
  const { children } = node;
  if (!children) return '';

  return children
    .map(child => child.isDirectory ? `${child.name}/` : child.name)
    .join('  ');
}

function renderDetailedList(node: FileNode): string {
  const { children } = node;
  if (!children) return '';

  let output = '';
  for (const child of children) {
    const { name, size, isDirectory, timestamp } = child;
    const formattedName = isDirectory ? `${name}/` : name;
    const formattedSize = formatFileSize(size || 0);
    const formattedDate = formatDateTime(timestamp || Date.now());
    output += `${formattedSize}  ${formattedDate}  ${formattedName}\n`;
  }
  return output;
}

interface LsProps {
  overrideArgs?: string[];
}

const Ls: React.FC<LsProps> = ({ overrideArgs }) => {
  const { arg } = useContext(termContext);
  const { allFileNode } = useContext(homeContext);

  const args = overrideArgs || arg;

  // Parse arguments
  let showDetailed = false;
  let targetPath = '';

  for (const a of args) {
    if (a === '-l') {
      showDetailed = true;
    } else if (!a.startsWith('-')) {
      targetPath = a;
    }
  }

  // Find target directory
  let targetNode = allFileNode;
  if (targetPath) {
    const found = findFileByPath(allFileNode, targetPath);
    if (!found) {
      return <ErrorMessage>ls: {targetPath}: No such file or directory</ErrorMessage>;
    }
    if (!found.isDirectory) {
      return <ErrorMessage>ls: {targetPath}: Not a directory</ErrorMessage>;
    }
    targetNode = found;
  }

  const output = showDetailed
    ? renderDetailedList(targetNode)
    : renderSimpleList(targetNode);

  return (
    <Wrapper>
      <pre>{output}</pre>
    </Wrapper>
  );
};

export default Ls;
