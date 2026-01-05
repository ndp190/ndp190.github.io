import { describe, it, expect } from 'vitest';
import { findFileByPath, getAllFilePaths, getMatchingPaths } from '../utils/fileUtils';
import { FileNode } from '../types/files';

const mockFileTree: FileNode = {
  name: 'terminal',
  path: 'terminal',
  isDirectory: true,
  children: [
    {
      name: 'about-me.md',
      path: 'terminal/about-me.md',
      isDirectory: false,
      content: '# About Me',
    },
    {
      name: 'blog',
      path: 'terminal/blog',
      isDirectory: true,
      children: [
        {
          name: 'hello-world.md',
          path: 'terminal/blog/hello-world.md',
          isDirectory: false,
          content: '# Hello World',
        },
        {
          name: 'second-post.md',
          path: 'terminal/blog/second-post.md',
          isDirectory: false,
          content: '# Second Post',
        },
      ],
    },
  ],
};

describe('findFileByPath', () => {
  it('finds a file at root level', () => {
    const result = findFileByPath(mockFileTree, 'about-me.md');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('about-me.md');
  });

  it('finds a file in a subdirectory', () => {
    const result = findFileByPath(mockFileTree, 'blog/hello-world.md');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('hello-world.md');
  });

  it('returns null for non-existent file', () => {
    const result = findFileByPath(mockFileTree, 'non-existent.md');
    expect(result).toBeNull();
  });

  it('finds a directory', () => {
    const result = findFileByPath(mockFileTree, 'blog');
    expect(result).not.toBeNull();
    expect(result?.isDirectory).toBe(true);
  });
});

describe('getAllFilePaths', () => {
  it('returns all file paths', () => {
    const paths = getAllFilePaths(mockFileTree);
    expect(paths).toContain('about-me.md');
    expect(paths).toContain('blog/hello-world.md');
    expect(paths).toContain('blog/second-post.md');
  });

  it('does not include directories', () => {
    const paths = getAllFilePaths(mockFileTree);
    expect(paths).not.toContain('blog');
    expect(paths).not.toContain('terminal');
  });
});

describe('getMatchingPaths', () => {
  it('returns all paths when no partial path', () => {
    const paths = getMatchingPaths(mockFileTree, '');
    expect(paths.length).toBe(3);
  });

  it('filters paths by partial path', () => {
    const paths = getMatchingPaths(mockFileTree, 'blog/');
    expect(paths.length).toBe(2);
    expect(paths).toContain('blog/hello-world.md');
    expect(paths).toContain('blog/second-post.md');
  });

  it('filters paths by filename prefix', () => {
    const paths = getMatchingPaths(mockFileTree, 'blog/h');
    expect(paths.length).toBe(1);
    expect(paths[0]).toBe('blog/hello-world.md');
  });

  it('returns empty array for no matches', () => {
    const paths = getMatchingPaths(mockFileTree, 'nonexistent/');
    expect(paths.length).toBe(0);
  });
});
