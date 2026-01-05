/**
 * Build-time data generation script
 *
 * This script runs before Vite build to generate JSON data files
 * that replace Next.js's getStaticProps functionality.
 *
 * Reads:
 * - public/terminal/ directory tree with markdown content
 * - public/i18n/ translations
 *
 * Outputs:
 * - src/data/fileTree.json
 * - src/data/translations.json
 */

import fs from 'fs'
import path from 'path'

// Types
interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  timestamp?: number;
  content?: string;
  children?: FileNode[];
}

type Language = 'en' | 'vn';
type TranslationsMap = Record<string, string>;
type AllTranslations = Partial<Record<Language, TranslationsMap>>;

// Read directory recursively and build file tree
function readDirectory(directoryPath: string, relativePath: string = ''): FileNode {
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

// Recursively read translation files
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
    } else if (item.endsWith('.md')) {
      // Map to terminal path (e.g., "blog/hello-world.md" -> "terminal/blog/hello-world.md")
      const terminalPath = `terminal/${itemRelativePath}`;
      map[terminalPath] = fs.readFileSync(fullPath, 'utf-8');
    }
  }
}

// Read all translations from public/i18n/{lang}/ directory
function readTranslations(i18nPath: string): AllTranslations {
  const translations: AllTranslations = {};

  if (!fs.existsSync(i18nPath)) {
    return translations;
  }

  const languages = fs.readdirSync(i18nPath);

  for (const lang of languages) {
    const langPath = path.join(i18nPath, lang);
    if (!fs.lstatSync(langPath).isDirectory()) continue;

    translations[lang as Language] = {};
    readTranslationFiles(langPath, '', translations[lang as Language]!);
  }

  return translations;
}

// Main
function main() {
  console.log('Generating data files...');

  const publicDir = path.join(process.cwd(), 'public');
  const dataDir = path.join(process.cwd(), 'src/data');

  // Ensure data directory exists
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // Generate file tree
  const terminalDir = path.join(publicDir, 'terminal');
  if (fs.existsSync(terminalDir)) {
    console.log('Reading terminal directory...');
    const fileTree = readDirectory(terminalDir);
    fs.writeFileSync(
      path.join(dataDir, 'fileTree.json'),
      JSON.stringify(fileTree, null, 2)
    );
    console.log('Generated fileTree.json');
  } else {
    console.log('Warning: public/terminal not found, creating empty file tree');
    fs.writeFileSync(
      path.join(dataDir, 'fileTree.json'),
      JSON.stringify({
        name: 'terminal',
        path: 'terminal',
        isDirectory: true,
        children: []
      }, null, 2)
    );
  }

  // Generate translations
  const i18nDir = path.join(publicDir, 'i18n');
  if (fs.existsSync(i18nDir)) {
    console.log('Reading translations...');
    const translations = readTranslations(i18nDir);
    fs.writeFileSync(
      path.join(dataDir, 'translations.json'),
      JSON.stringify(translations, null, 2)
    );
    console.log('Generated translations.json');
  } else {
    console.log('Warning: public/i18n not found, creating empty translations');
    fs.writeFileSync(
      path.join(dataDir, 'translations.json'),
      JSON.stringify({}, null, 2)
    );
  }

  console.log('Data files generated successfully!');
}

main();
