import { homeContext } from "@/pages";
import { FileNode } from "@/utils/listFiles";
import React, { useContext } from "react";
import { Wrapper } from "../styles/Output.styled";

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  // const options = { month: 'short', day: 'numeric' };
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return date.toLocaleString('en-US', options);
}

function formatFileSize(size: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(0)}${units[index]}`;
}

function renderNode(node: FileNode): string {
  const { children } = node;
  let output = '';

  if (!children) {
    return output;
  }

  if (children) {
    for (let i = 0; i < children.length; i++) {
      const { name, size, isDirectory, timestamp } = children[i];
      const formattedName = isDirectory ? `${name}/` : name;
      output += `${formatFileSize(size!)}\t${formatDate(timestamp!)}\t${formattedName}\n`;
    }
  }

  return output;
}

const Ls = () => {
  const { allFileNode } = useContext(homeContext);
  // TODO use route to set current directory
  // TODO update to looks more like ls (one level with suggestion)
  // TODO support tree command

  return (
    <Wrapper>
      <pre>{renderNode(allFileNode)}</pre>
    </Wrapper>
  );
};

export default Ls;

