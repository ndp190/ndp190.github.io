// import { checkThemeSwitch, getCurrentCmdArry } from "@/utils/funcs";
// import { useContext, useEffect } from "react";
// import { termContext } from "../Terminal";

import { homeContext } from "@/pages";
import { getCurrentCmdArry } from "@/utils/funcs";
import { useContext, useEffect } from "react";
import { Wrapper } from "../styles/Terminal.styled";
import { termContext } from "../Terminal";

const Cd = () => {
  const { history, rerender } = useContext(termContext);
  const { allFileNode, currentFileNode } = useContext(homeContext);
  // TODO need to store current node

  /* ===== get current command ===== */
  const currentCommand = getCurrentCmdArry(history);

  /* ===== check current command makes redirect ===== */
  useEffect(() => {
    if (
      rerender && // is submitted
      currentCommand[0] === "cd" &&
      currentCommand.length === 2 // current command has one arg
    ) {
      console.log('in');
      // if directory not existed then show error
      // else redirect to that directory
        // set current node to that directory
      // change route if direction changed
    }
    // if (checkThemeSwitch(rerender, currentCommand, myThemes)) {
    //   themeSwitcher?.(theme[currentCommand[2]]);
    // }
  }, [rerender, currentCommand, allFileNode]);
  return (
    <Wrapper>
    </Wrapper>
  );
};

export default Cd;

// AI generated code
// import { useState } from 'react';
// import { FileNode } from './types';

// interface HomeContextProps {
//   allFileNode: FileNode[];
//   currentFileNode: FileNode;
//   setCurrentFileNode: (node: FileNode) => void;
// }

// const HomeContext = createContext<HomeContextProps>({
//   allFileNode: [],
//   currentFileNode: { name: '', isDirectory: true },
//   setCurrentFileNode: () => {},
// });

// const Cd = () => {
//   const { history, rerender } = useContext(termContext);
//   const { allFileNode, currentFileNode, setCurrentFileNode } = useContext(homeContext);

//   /* ===== get current command ===== */
//   const currentCommand = getCurrentCmdArry(history);

//   /* ===== check current command makes redirect ===== */
//   useEffect(() => {
//     if (
//       rerender && // is submitted
//       currentCommand[0] === "cd" &&
//       currentCommand.length === 2 // current command has one arg
//     ) {
//       // split the path into an array of directory names
//       const path = currentCommand[1].split('/');

//       // iterate through the path array to traverse the parent directories
//       let directoryNode = currentFileNode;
//       for (const directoryName of path) {
//         if (directoryName === '..') {
//           // traverse to the parent directory
//           directoryNode = findParentDirectoryNode(allFileNode, directoryNode);
//         } else {
//           // traverse to the child directory
//           directoryNode = findChildDirectoryNode(directoryNode, directoryName);
//         }

//         if (!directoryNode) {
//           // show error message
//           return;
//         }
//       }

//       // set the currentFileNode to the directory node
//       setCurrentFileNode(directoryNode);
//       // change route if direction changed
//     }
//   }, [rerender, currentCommand, allFileNode, currentFileNode, setCurrentFileNode]);

//   // find the parent directory node of a given node
//   const findParentDirectoryNode = (nodes: FileNode[], node: FileNode): FileNode | undefined => {
//     const parentPath = node.name.split('/').slice(0, -1);
//     if (parentPath.length === 0) {
//       // base case: node is at the root level
//       return nodes.find(node => node.isDirectory);
//     } else {
//       // recursive case: find the parent directory node
//       const parentDirectoryName = parentPath.join('/');
//       const parentNode = findChildDirectoryNode(nodes.find(node => node.name === parentDirectoryName && node.isDirectory), '..');
//       if (parentNode) {
//         return parentNode;
//       } else {
//         return undefined;
//       }
//     }
//   };

//   // find the child directory node of a given node
//   const findChildDirectoryNode = (node: FileNode, directoryName: string): FileNode | undefined => {
//     if (node.children) {
//       return node.children.find(childNode => childNode.name === directoryName && childNode.isDirectory);
//     } else {
//       return undefined;
//     }
//   };

//   return (
//     <Wrapper>
//       {/* your code here */}
//     </Wrapper>
//   );
// };

