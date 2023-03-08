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

function renderNodeTree(node: FileNode, isLastList: boolean[] = []): string {
  const { name, children, isDirectory } = node;
  const isRoot = isLastList.length === 0;
  const branch = isRoot ? '' : isLastList.slice(0, -1).reduceRight((acc, isLast) => {
    return `${isLast ? '-' : '│'}    ${acc}`;
  }, isLastList.slice(-1)[0] ? '└──' : '├──');
  console.log(node.name, isLastList, branch);

  const formattedName = isDirectory ? `${name}/` : name;
  const displayName = isRoot ? '.' : formattedName;
  let output = `${branch} ${displayName}\n`;

  if (children) {
    const lastChildIndex = children.length - 1;
    children.forEach((childNode, index) => {
      const isLast = index === lastChildIndex;
      output += renderNodeTree(childNode, [...isLastList, isLast]);
    });
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
      <pre>{renderNodeTree(allFileNode)}</pre>
    </Wrapper>
  );
};

export default Ls;

