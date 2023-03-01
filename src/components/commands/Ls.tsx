import { homeContext } from "@/pages";
import { FileNode } from "@/utils/listFiles";
import React, { useContext } from "react";
import { Wrapper } from "../styles/Output.styled";

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleString();
}

function formatFileSize(size: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  return `${size.toFixed(1)} ${units[index]}`;
}

function renderNode(node: FileNode, indent = ""): string {
  const { name, isDirectory, size, timestamp, children } = node;

  let output = indent;

  if (isDirectory) {
    output += `${name}/\n`;
  } else {
    output += `${name} (${formatFileSize(size!)}) ${formatDate(timestamp!)}\n`;
  }

  if (children) {
    indent += "  ";
    for (let i = 0; i < children.length; i++) {
      output += renderNode(children[i], indent);
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

