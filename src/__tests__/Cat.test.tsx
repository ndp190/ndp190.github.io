import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import theme from '../components/styles/themes';
import Cat from '../components/commands/Cat';
import { termContext } from '../components/Terminal';
import { homeContext } from '../pages';
import { FileNode } from '../types/files';

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
      ],
    },
  ],
};

interface RenderCatOptions {
  arg?: string[];
  history?: string[];
  index?: number;
  rerender?: boolean;
}

const renderCat = (options: RenderCatOptions = {}) => {
  const {
    arg = [],
    history = ['cat blog/hello-world.md'],
    index = 0,
    rerender = false,
  } = options;

  const termContextValue = {
    arg,
    history,
    rerender,
    index,
    clearHistory: jest.fn(),
    executeCommand: jest.fn(),
  };

  return render(
    <ThemeProvider theme={defaultTheme}>
      <homeContext.Provider value={{ allFileNode: mockFileTree }}>
        <termContext.Provider value={termContextValue}>
          <Cat />
        </termContext.Provider>
      </homeContext.Provider>
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
    it('scrolls to content on initial page load (history.length === 1)', async () => {
      renderCat({
        arg: ['blog/hello-world.md'],
        history: ['cat blog/hello-world.md'], // Only 1 item = initial page load
        index: 0,
      });

      // Fast-forward timers to trigger the setTimeout
      jest.advanceTimersByTime(100);

      await waitFor(() => {
        expect(mockScrollIntoView).toHaveBeenCalledWith({
          behavior: 'auto',
          block: 'start',
        });
      });
    });

    it('does NOT scroll when user types cat command (history.length > 1)', async () => {
      renderCat({
        arg: ['blog/hello-world.md'],
        history: ['cat blog/hello-world.md', 'welcome'], // 2 items = user typed command
        index: 0,
      });

      jest.advanceTimersByTime(100);

      // Should NOT have been called
      expect(mockScrollIntoView).not.toHaveBeenCalled();
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

    it('does NOT scroll when user types after running cat (simulating rerender cycle)', async () => {
      // First render: cat command just executed
      const { rerender } = renderCat({
        arg: ['blog/hello-world.md'],
        history: ['cat blog/hello-world.md', 'welcome'], // User already had previous command
        index: 0,
        rerender: true,
      });

      jest.advanceTimersByTime(100);

      // Should not scroll because history.length > 1
      expect(mockScrollIntoView).not.toHaveBeenCalled();

      // Simulate user starting to type (rerender becomes false)
      // This was the bug - it used to scroll when rerender changed
      rerender(
        <ThemeProvider theme={defaultTheme}>
          <homeContext.Provider value={{ allFileNode: mockFileTree }}>
            <termContext.Provider
              value={{
                arg: ['blog/hello-world.md'],
                history: ['cat blog/hello-world.md', 'welcome'],
                rerender: false, // User is typing
                index: 0,
                clearHistory: jest.fn(),
                executeCommand: jest.fn(),
              }}
            >
              <Cat />
            </termContext.Provider>
          </homeContext.Provider>
        </ThemeProvider>
      );

      jest.advanceTimersByTime(100);

      // Should still NOT scroll - this was the flickering bug
      expect(mockScrollIntoView).not.toHaveBeenCalled();
    });

    it('only scrolls once even with multiple rerenders', async () => {
      const { rerender } = renderCat({
        arg: ['blog/hello-world.md'],
        history: ['cat blog/hello-world.md'], // Initial page load
        index: 0,
      });

      jest.advanceTimersByTime(100);

      // Should have scrolled once
      expect(mockScrollIntoView).toHaveBeenCalledTimes(1);

      // Simulate multiple rerenders (e.g., state changes)
      for (let i = 0; i < 3; i++) {
        rerender(
          <ThemeProvider theme={defaultTheme}>
            <homeContext.Provider value={{ allFileNode: mockFileTree }}>
              <termContext.Provider
                value={{
                  arg: ['blog/hello-world.md'],
                  history: ['cat blog/hello-world.md'],
                  rerender: false,
                  index: 0,
                  clearHistory: jest.fn(),
                  executeCommand: jest.fn(),
                }}
              >
                <Cat />
              </termContext.Provider>
            </homeContext.Provider>
          </ThemeProvider>
        );
        jest.advanceTimersByTime(100);
      }

      // Should still only have scrolled once due to hasScrolled ref
      expect(mockScrollIntoView).toHaveBeenCalledTimes(1);
    });
  });

  describe('edge cases', () => {
    it('handles file with empty content', () => {
      const fileTreeWithEmptyFile: FileNode = {
        ...mockFileTree,
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

      render(
        <ThemeProvider theme={defaultTheme}>
          <homeContext.Provider value={{ allFileNode: fileTreeWithEmptyFile }}>
            <termContext.Provider
              value={{
                arg: ['empty.md'],
                history: ['cat empty.md'],
                rerender: false,
                index: 0,
                clearHistory: jest.fn(),
                executeCommand: jest.fn(),
              }}
            >
              <Cat />
            </termContext.Provider>
          </homeContext.Provider>
        </ThemeProvider>
      );

      expect(screen.getByText(/Unable to read file/)).toBeInTheDocument();
    });

    it('handles nested file paths', () => {
      renderCat({ arg: ['blog/hello-world.md'] });
      expect(screen.getByText(/Hello World/)).toBeInTheDocument();
    });
  });
});
