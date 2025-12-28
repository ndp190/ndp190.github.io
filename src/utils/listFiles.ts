import fs from "fs";
import path from "path";

export type { FileNode } from "../types/files";
import type { FileNode } from "../types/files";
import type { Bookmark, BookmarkJson } from "../types/bookmark";

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

export function readBookmarks(directoryPath: string): Bookmark[] {
  const absolutePath = path.join(process.cwd(), directoryPath);

  if (!fs.existsSync(absolutePath)) {
    return [];
  }

  const files = fs.readdirSync(absolutePath);
  const bookmarks: Bookmark[] = [];
  let id = 1;

  for (const file of files) {
    if (!file.endsWith('.json')) continue;

    const filePath = path.join(absolutePath, file);
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const json: BookmarkJson = JSON.parse(content);

      if (!json.success || !json.data) continue;

      const { metadata, markdown } = json.data;

      bookmarks.push({
        id: id++,
        title: metadata.ogTitle || metadata.title || 'Untitled',
        description: metadata.ogDescription || metadata.description || '',
        url: metadata.sourceURL || metadata.url || '',
        markdown: markdown || '',
      });
    } catch (e) {
      console.error(`Failed to read bookmark: ${file}`, e);
    }
  }

  return bookmarks;
}
