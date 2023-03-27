import { FileNode } from "./listFiles";

export function navigateFileNode(currentNode: FileNode, path: string): string[] {
  const mapChildName = (child: FileNode) => child.name + (child.isDirectory ? '/' : '');
  const children = currentNode.children || [];

  if (!path) {
    return children.map(mapChildName);
  }

  const parts = path.split(/(?<=\/)/);
  const targetName = parts[0];
  const targetNode = children.find(child => mapChildName(child) === targetName);
  if (!targetNode) {
    return children
      .filter(child => child.name.startsWith(targetName))
      .map(mapChildName);
  }
  if (parts.length === 1) {
    if (targetNode.isDirectory) {
      return (targetNode.children || []).map(mapChildName);
    } else {
      return [];
    }
  }
  const remainingPath = parts.slice(1).join('');
  return navigateFileNode(targetNode, remainingPath);
}

