export interface FileNode {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  timestamp?: number;
  content?: string;
  children?: FileNode[];
}
