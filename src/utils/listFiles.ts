import fs from "fs";
import path from "path";

export type { FileNode } from "../types/files";
import type { FileNode } from "../types/files";

export function listFiles(filePath: string): string[] {
  const absolutePath = path.join(process.cwd(), "public", filePath);
  const files = fs.readdirSync(absolutePath);
  return files.map(file => {
    const isFolder = fs.lstatSync(path.join(absolutePath, file)).isDirectory();
    return isFolder ? `${file}/` : file;
  });
}

export function readDirectory(directoryPath: string, relativePath: string = ''): FileNode {
  const name = path.basename(directoryPath);
  const isDirectory = fs.lstatSync(directoryPath).isDirectory();
  const currentPath = relativePath ? `${relativePath}/${name}` : name;
  const fileNode: FileNode = { name, path: currentPath, isDirectory };

  if (isDirectory) {
    const fileNames = fs.readdirSync(directoryPath);
    const children = fileNames.map((fileName) => {
      const filePath = path.join(directoryPath, fileName);
      return readDirectory(filePath, currentPath);
    });

    const stats = fs.statSync(directoryPath);
    fileNode.size = stats.size;
    fileNode.timestamp = stats.mtimeMs;

    fileNode.children = children;
  } else {
    const stats = fs.statSync(directoryPath);
    fileNode.size = stats.size;
    fileNode.timestamp = stats.mtimeMs;

    // Read content for markdown files
    if (name.endsWith('.md')) {
      fileNode.content = fs.readFileSync(directoryPath, 'utf-8');
    }
  }

  return fileNode;
}
