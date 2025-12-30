import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import theme from '../components/styles/themes';
import Cat from '../components/commands/Cat';
import { termContext } from '../components/Terminal';
import { homeContext } from '../pages';
import { languageContext } from '../pages/_app';
import { FileNode } from '../types/files';
import { Language } from '../utils/useLanguage';
import { AllTranslations } from '../utils/listFiles';

const defaultTheme = theme.dark;

// Mock scrollIntoView
const mockScrollIntoView = jest.fn();
Element.prototype.scrollIntoView = mockScrollIntoView;

// Sample file tree for testing
const mockFileTree: FileNode = {
  name: 'terminal',
  path: 'terminal',
  isDirectory: true,
  children: [
    {
      name: 'blog',
      path: 'terminal/blog',
      isDirectory: true,
      children: [
        {
          name: 'hello-world.md',
          path: 'terminal/blog/hello-world.md',
          isDirectory: false,
          content: '# Hello World\n\nThis is a test blog post.',
          size: 100,
          timestamp: Date.now(),
        },
        {
          name: 'english-only.md',
          path: 'terminal/blog/english-only.md',
          isDirectory: false,
          content: '# English Only\n\nNo Vietnamese version available.',
          size: 100,
          timestamp: Date.now(),
        },
      ],
    },
  ],
};

// Mock translations
const mockTranslations: AllTranslations = {
  vn: {
    'terminal/blog/hello-world.md': '# Xin Chào\n\nĐây là bài viết tiếng Việt.',
  },
};

interface RenderCatOptions {
  arg?: string[];
  history?: string[];
  index?: number;
  rerender?: boolean;
  language?: Language;
  fileTree?: FileNode;
  translations?: AllTranslations;
}

const renderCat = (options: RenderCatOptions = {}) => {
  const {
    arg = [],
    history = ['cat blog/hello-world.md'],
    index = 0,
    rerender = false,
    language = 'en',
    fileTree = mockFileTree,
    translations = mockTranslations,
  } = options;

  const termContextValue = {
    arg,
    history,
    rerender,
    index,
    clearHistory: jest.fn(),
    executeCommand: jest.fn(),
  };

  const languageContextValue = {
    language,
    setLanguage: jest.fn(),
  };

  return render(
    <ThemeProvider theme={defaultTheme}>
      <languageContext.Provider value={languageContextValue}>
        <homeContext.Provider value={{ allFileNode: fileTree, translations }}>
          <termContext.Provider value={termContextValue}>
            <Cat />
          </termContext.Provider>
        </homeContext.Provider>
      </languageContext.Provider>
    </ThemeProvider>
  );
};

describe('Cat component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('file display', () => {
    it('shows usage message when no file path provided', () => {
      renderCat({ arg: [] });
      expect(screen.getByText(/Usage: cat/)).toBeInTheDocument();
    });

    it('shows error for non-existent file', () => {
      renderCat({ arg: ['nonexistent.md'] });
      expect(screen.getByText(/No such file or directory/)).toBeInTheDocument();
    });

    it('shows error when trying to cat a directory', () => {
      renderCat({ arg: ['blog'] });
      expect(screen.getByText(/Is a directory/)).toBeInTheDocument();
    });

    it('renders markdown content for valid file', () => {
      renderCat({ arg: ['blog/hello-world.md'] });
      expect(screen.getByText(/Hello World/)).toBeInTheDocument();
    });
  });

  describe('scroll behavior', () => {
    it('scrolls to content on initial page load (direct URL access)', async () => {
      renderCat({
        arg: ['blog/hello-world.md'],
        history: ['cat blog/hello-world.md'],
        index: 0,
      });

      jest.advanceTimersByTime(100);

      await waitFor(() => {
        expect(mockScrollIntoView).toHaveBeenCalledWith({
          behavior: 'auto',
          block: 'start',
        });
      });
    });

    it('scrolls to content when user types cat command', async () => {
      renderCat({
        arg: ['blog/hello-world.md'],
        history: ['cat blog/hello-world.md', 'welcome'], // User typed cat after welcome
        index: 0, // Cat is the most recent command
      });

      jest.advanceTimersByTime(100);

      await waitFor(() => {
        expect(mockScrollIntoView).toHaveBeenCalledWith({
          behavior: 'auto',
          block: 'start',
        });
      });
    });

    it('does NOT scroll when cat is not the most recent command (index > 0)', async () => {
      renderCat({
        arg: ['blog/hello-world.md'],
        history: ['help', 'cat blog/hello-world.md'],
        index: 1, // Cat is at index 1, not 0
      });

      jest.advanceTimersByTime(100);

      expect(mockScrollIntoView).not.toHaveBeenCalled();
    });

    it('does NOT scroll again when user types after running cat (no flickering)', async () => {
      // First render: cat command just executed, scrolls once
      renderCat({
        arg: ['blog/hello-world.md'],
        history: ['cat blog/hello-world.md', 'welcome'],
        index: 0,
        rerender: true,
      });

      jest.advanceTimersByTime(100);

      // Should have scrolled once
      expect(mockScrollIntoView).toHaveBeenCalledTimes(1);

      // The hasScrolled ref prevents scrolling again during the same component instance
      // This test verifies the scroll happened only once for this render
    });

    it('scrolls only once per cat command execution', async () => {
      // When cat command is executed (index 0), it should scroll once
      renderCat({
        arg: ['blog/hello-world.md'],
        history: ['cat blog/hello-world.md'],
        index: 0,
      });

      jest.advanceTimersByTime(100);

      // Should have scrolled exactly once
      expect(mockScrollIntoView).toHaveBeenCalledTimes(1);
      expect(mockScrollIntoView).toHaveBeenCalledWith({
        behavior: 'auto',
        block: 'start',
      });
    });
  });

  describe('edge cases', () => {
    it('handles file with empty content', () => {
      const fileTreeWithEmptyFile: FileNode = {
        name: 'terminal',
        path: 'terminal',
        isDirectory: true,
        children: [
          {
            name: 'empty.md',
            path: 'terminal/empty.md',
            isDirectory: false,
            content: '',
            size: 0,
            timestamp: Date.now(),
          },
        ],
      };

      renderCat({
        arg: ['empty.md'],
        history: ['cat empty.md'],
        fileTree: fileTreeWithEmptyFile,
      });

      expect(screen.getByText(/Unable to read file/)).toBeInTheDocument();
    });

    it('handles nested file paths', () => {
      renderCat({ arg: ['blog/hello-world.md'] });
      expect(screen.getByText(/Hello World/)).toBeInTheDocument();
    });
  });

  describe('language switching', () => {
    it('shows English content when language is en', () => {
      renderCat({
        arg: ['blog/hello-world.md'],
        language: 'en',
      });
      expect(screen.getByText(/Hello World/)).toBeInTheDocument();
      expect(screen.queryByText(/Xin Chào/)).not.toBeInTheDocument();
    });

    it('shows Vietnamese content when language is vn and translation exists', () => {
      renderCat({
        arg: ['blog/hello-world.md'],
        language: 'vn',
      });
      expect(screen.getByText(/Xin Chào/)).toBeInTheDocument();
      expect(screen.queryByText(/Hello World/)).not.toBeInTheDocument();
    });

    it('falls back to English when language is vn but no translation exists', () => {
      renderCat({
        arg: ['blog/english-only.md'],
        language: 'vn',
      });
      expect(screen.getByText(/English Only/)).toBeInTheDocument();
    });

    it('shows Vietnamese content with Vietnamese text', () => {
      renderCat({
        arg: ['blog/hello-world.md'],
        language: 'vn',
      });
      expect(screen.getByText(/Đây là bài viết tiếng Việt/)).toBeInTheDocument();
    });
  });
});
