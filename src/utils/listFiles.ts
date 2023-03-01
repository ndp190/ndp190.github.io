import fs from "fs";
import path from "path";

export function listFiles(filePath: string): string[] {
  const absolutePath = path.join(process.cwd(), "public", filePath);
  const files = fs.readdirSync(absolutePath);
  return files.map(file => {
    const isFolder = fs.lstatSync(path.join(absolutePath, file)).isDirectory();
    return isFolder ? `${file}/` : file;
  });
}

export interface FileNode {
  name: string;
  isDirectory: boolean;
  size?: number;
  timestamp?: number;
  children?: FileNode[];
}

export function readDirectory(directoryPath: string): FileNode {
  const name = path.basename(directoryPath);
  const isDirectory = fs.lstatSync(directoryPath).isDirectory();
  const fileNode: FileNode = { name, isDirectory };

  if (isDirectory) {
    const fileNames = fs.readdirSync(directoryPath);
    const children = fileNames.map((fileName) => {
      const filePath = path.join(directoryPath, fileName);
      return readDirectory(filePath);
    });

    const stats = fs.statSync(directoryPath);
    fileNode.size = stats.size;
    fileNode.timestamp = stats.mtimeMs;

    fileNode.children = children;
  } else {
    const stats = fs.statSync(directoryPath);
    fileNode.size = stats.size;
    fileNode.timestamp = stats.mtimeMs;
  }

  return fileNode;
}
