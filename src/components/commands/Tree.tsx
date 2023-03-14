import { homeContext } from "@/pages";
import { FileNode } from "@/utils/listFiles";
import React, { useContext } from "react";
import { Wrapper } from "../styles/Output.styled";

function renderNodeTree(node: FileNode, isLastList: boolean[] = []): string {
  const { name, children, isDirectory } = node;
  const isRoot = isLastList.length === 0;
  const branch = isRoot ? '' : isLastList.slice(0, -1).reduceRight((acc, isLast) => {
    return `${isLast ? ' ' : '│'}    ${acc}`;
  }, isLastList.slice(-1)[0] ? '└──' : '├──');

  const formattedName = isDirectory ? `${name}/` : name;
  let output = isRoot ? `.\n` : `${branch} ${formattedName}\n`;

  if (children) {
    const lastChildIndex = children.length - 1;
    children.forEach((childNode, index) => {
      const isLast = index === lastChildIndex;
      output += renderNodeTree(childNode, [...isLastList, isLast]);
    });
  }

  return output;
}

const Tree = () => {
  const { allFileNode } = useContext(homeContext);
  return (
    <Wrapper>
      <pre>{renderNodeTree(allFileNode)}</pre>
    </Wrapper>
  );
};

export default Tree;

