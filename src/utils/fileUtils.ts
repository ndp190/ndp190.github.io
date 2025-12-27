import { FileNode } from "../types/files";

export function findFileByPath(node: FileNode, targetPath: string): FileNode | null {
  // Normalize the target path (remove leading ./ or /)
  const normalizedTarget = targetPath.replace(/^\.?\//, '');

  // Check if current node matches
  if (node.path === normalizedTarget || node.path === `terminal/${normalizedTarget}`) {
    return node;
  }

  // Search in children
  if (node.children) {
    for (const child of node.children) {
      const found = findFileByPath(child, targetPath);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Get all file paths from the file tree (relative to terminal/)
 */
export function getAllFilePaths(node: FileNode, prefix: string = ''): string[] {
  const paths: string[] = [];

  // Skip the root 'terminal' node in the path
  const currentPath = node.path.replace(/^terminal\/?/, '');

  if (currentPath && !node.isDirectory) {
    paths.push(currentPath);
  }

  if (node.children) {
    for (const child of node.children) {
      paths.push(...getAllFilePaths(child, currentPath));
    }
  }

  return paths;
}

/**
 * Get files in a directory that match a partial path
 */
export function getMatchingPaths(node: FileNode, partialPath: string): string[] {
  const allPaths = getAllFilePaths(node);

  if (!partialPath) {
    return allPaths;
  }

  return allPaths.filter(p => p.startsWith(partialPath));
}
