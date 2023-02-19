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
