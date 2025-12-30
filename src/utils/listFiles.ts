import fs from "fs";
import path from "path";

export type { FileNode } from "../types/files";
import type { FileNode } from "../types/files";
import type { Language } from "./useLanguage";

// Translation map: maps original file path to translated content
export type TranslationsMap = Record<string, string>;

// All translations by language
export type AllTranslations = Partial<Record<Language, TranslationsMap>>;

export function listFiles(filePath: string): string[] {
  const absolutePath = path.join(process.cwd(), "public", filePath);
  const files = fs.readdirSync(absolutePath);
  return files.map(file => {
    const isFolder = fs.lstatSync(path.join(absolutePath, file)).isDirectory();
    return isFolder ? `${file}/` : file;
  });
}

/**
 * Read all translations from public/i18n/{lang}/ directory
 * Returns a map of original file path -> translated content
 */
export function readTranslations(): AllTranslations {
  const i18nPath = path.join(process.cwd(), "public", "i18n");
  const translations: AllTranslations = {};

  if (!fs.existsSync(i18nPath)) {
    return translations;
  }

  const languages = fs.readdirSync(i18nPath);

  for (const lang of languages) {
    const langPath = path.join(i18nPath, lang);
    if (!fs.lstatSync(langPath).isDirectory()) continue;

    translations[lang as Language] = {};
    readTranslationFiles(langPath, "", translations[lang as Language]!);
  }

  return translations;
}

/**
 * Recursively read translation files and populate the map
 */
function readTranslationFiles(
  dirPath: string,
  relativePath: string,
  map: TranslationsMap
): void {
  const items = fs.readdirSync(dirPath);

  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    const itemRelativePath = relativePath ? `${relativePath}/${item}` : item;

    if (fs.lstatSync(fullPath).isDirectory()) {
      readTranslationFiles(fullPath, itemRelativePath, map);
    } else if (item.endsWith(".md")) {
      // Map to terminal path (e.g., "blog/hello-world.md" -> "terminal/blog/hello-world.md")
      const terminalPath = `terminal/${itemRelativePath}`;
      map[terminalPath] = fs.readFileSync(fullPath, "utf-8");
    }
  }
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
