import { FileNode } from "../types/files";

export function findFileByPath(node: FileNode, targetPath: string): FileNode | null {
  // Normalize the target path (remove leading ./ or / and trailing /)
  const normalizedTarget = targetPath.replace(/^\.?\//, '').replace(/\/$/, '');

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
export function getAllFilePaths(node: FileNode, _prefix: string = ''): string[] {
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
 * Get all paths (files and directories) from the file tree
 * Directories are returned with trailing /
 */
export function getAllPathsWithDirs(node: FileNode, _prefix: string = ''): string[] {
  const paths: string[] = [];

  // Skip the root 'terminal' node in the path
  const currentPath = node.path.replace(/^terminal\/?/, '');

  if (currentPath) {
    if (node.isDirectory) {
      paths.push(currentPath + '/');
    } else {
      paths.push(currentPath);
    }
  }

  if (node.children) {
    for (const child of node.children) {
      paths.push(...getAllPathsWithDirs(child, currentPath));
    }
  }

  return paths;
}

/**
 * Get paths that match a partial path at the current directory level
 * Like real terminal autocomplete - suggests one level at a time
 */
export function getMatchingPaths(node: FileNode, partialPath: string): string[] {
  const allPaths = getAllPathsWithDirs(node);

  // Determine the current directory level we're completing
  const lastSlashIndex = partialPath.lastIndexOf('/');
  const currentDir = lastSlashIndex >= 0 ? partialPath.substring(0, lastSlashIndex + 1) : '';
  const prefix = partialPath;

  // Filter paths that:
  // 1. Start with the partial path
  // 2. Are at the next level (not deeper)
  // 3. If prefix ends with /, don't include the directory itself (user wants contents)
  const matchingPaths = allPaths.filter(p => {
    if (!p.startsWith(prefix)) return false;

    // If user typed a path ending with /, don't match the directory itself
    // e.g., typing "docs/" should show contents of docs, not "docs/" itself
    if (prefix.endsWith('/') && p === prefix) return false;

    // Get the part after the current directory
    const remainingPath = p.substring(currentDir.length);

    // Check if this is at the immediate next level (no additional / except at the end for dirs)
    const slashInRemaining = remainingPath.indexOf('/');

    // If no slash, it's a file at this level
    if (slashInRemaining === -1) return true;

    // If slash is at the end, it's a directory at this level
    if (slashInRemaining === remainingPath.length - 1) return true;

    return false;
  });

  return matchingPaths;
}
