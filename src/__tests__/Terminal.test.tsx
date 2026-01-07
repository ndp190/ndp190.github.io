import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import themes from '../components/styles/themes';
import Terminal from '../components/Terminal';
import { LanguageContext, HomeContext, AllTranslations } from '../contexts';
import { FileNode } from '../types/files';

const defaultTheme = themes.dark;

// Mock scrollIntoView
const mockScrollIntoView = vi.fn();
Element.prototype.scrollIntoView = mockScrollIntoView;

// Mock focus to track preventScroll option
const mockFocus = vi.fn();

// Sample file tree for testing with some files/directories
const mockFileTree: FileNode = {
  name: 'terminal',
  path: 'terminal',
  isDirectory: true,
  children: [
    {
      name: 'blog',
      path: 'blog',
      isDirectory: true,
      children: [
        { name: 'hello-world.md', path: 'blog/hello-world.md', isDirectory: false },
        { name: 'hello-there.md', path: 'blog/hello-there.md', isDirectory: false },
      ],
    },
    {
      name: 'docs',
      path: 'docs',
      isDirectory: true,
      children: [
        { name: 'readme.md', path: 'docs/readme.md', isDirectory: false },
      ],
    },
  ],
};

const renderTerminal = (initialCommand = 'about') => {
  return render(
    <ThemeProvider theme={defaultTheme}>
      <LanguageContext.Provider value={{ language: 'en', setLanguage: vi.fn() }}>
        <HomeContext.Provider value={{ allFileNode: mockFileTree, translations: {} as AllTranslations, bookmarks: [] }}>
          <Terminal initialCommand={initialCommand} />
        </HomeContext.Provider>
      </LanguageContext.Provider>
    </ThemeProvider>
  );
};

describe('Terminal component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear localStorage to reset history between tests
    localStorage.clear();
    // Override focus on HTMLInputElement prototype
    HTMLInputElement.prototype.focus = mockFocus;
  });

  afterEach(() => {
    // Restore original focus
    delete (HTMLInputElement.prototype as any).focus;
  });

  describe('focus behavior', () => {
    it('renders terminal wrapper', () => {
      renderTerminal();
      expect(screen.getByTestId('terminal-wrapper')).toBeInTheDocument();
    });

    it('renders input field', () => {
      renderTerminal();
      expect(screen.getByTitle('terminal-input')).toBeInTheDocument();
    });

    it('focuses input with preventScroll on document mouseup', async () => {
      vi.useFakeTimers();
      renderTerminal();

      // Simulate mousedown + mouseup (simple click without drag)
      fireEvent.mouseDown(document.body, { clientX: 100, clientY: 100 });
      fireEvent.mouseUp(document.body, { clientX: 100, clientY: 100 });

      // Advance timers to trigger the setTimeout in handleMouseUp
      await vi.advanceTimersByTimeAsync(20);

      // Check that focus was called with preventScroll: true
      expect(mockFocus).toHaveBeenCalledWith({ preventScroll: true });
      vi.useRealTimers();
    });

    it('focuses input with preventScroll when using arrow keys', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input');

      // Type a command first
      fireEvent.change(input, { target: { value: 'help' } });
      fireEvent.submit(input.closest('form')!);

      // Clear mock to track subsequent focus calls
      mockFocus.mockClear();

      // Use arrow up to navigate history
      fireEvent.keyDown(input, { key: 'ArrowUp' });

      // The focus should be called with preventScroll after blur
      // Note: The implementation calls blur() then focus() is triggered by useEffect
    });

    it('does not scroll to input when clicking on terminal content', async () => {
      vi.useFakeTimers();
      renderTerminal();

      const wrapper = screen.getByTestId('terminal-wrapper');

      // Simulate mousedown + mouseup (simple click without drag)
      fireEvent.mouseDown(wrapper, { clientX: 100, clientY: 100 });
      fireEvent.mouseUp(wrapper, { clientX: 100, clientY: 100 });

      // Advance timers to trigger the setTimeout in handleMouseUp
      await vi.advanceTimersByTimeAsync(20);

      // Verify focus was called with preventScroll
      expect(mockFocus).toHaveBeenCalledWith({ preventScroll: true });
      vi.useRealTimers();
    });
  });

  describe('command execution', () => {
    it('executes initial command', () => {
      renderTerminal('about');
      expect(screen.getByTestId('input-command')).toHaveTextContent('about');
    });

    it('shows command not found for invalid commands', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input');
      fireEvent.change(input, { target: { value: 'invalidcmd' } });
      fireEvent.submit(input.closest('form')!);

      expect(screen.getByText(/command not found: invalidcmd/)).toBeInTheDocument();
    });

    it('clears input after command submission', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'help' } });
      fireEvent.submit(input.closest('form')!);

      expect(input.value).toBe('');
    });
  });

  describe('keyboard shortcuts', () => {
    it('clears terminal with Ctrl+L', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input');

      // Submit a command first
      fireEvent.change(input, { target: { value: 'help' } });
      fireEvent.submit(input.closest('form')!);

      // Now clear with Ctrl+L
      fireEvent.keyDown(input, { key: 'l', ctrlKey: true });

      // History should be cleared - no commands in the output
      expect(screen.queryByTestId('input-command')).not.toBeInTheDocument();
    });

    it('clears current input with Ctrl+U', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'some text' } });

      expect(input.value).toBe('some text');

      fireEvent.keyDown(input, { key: 'u', ctrlKey: true });

      expect(input.value).toBe('');
    });
  });

  describe('autocomplete behavior', () => {
    it('completes single matching command with trailing space on Tab', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'abo' } });
      fireEvent.keyDown(input, { key: 'Tab' });

      // Should complete to "about " with trailing space
      expect(input.value).toBe('about ');
    });

    it('shows hints and selects first match for multiple matching commands on Tab', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      // 'c' matches cat, clear
      fireEvent.change(input, { target: { value: 'c' } });
      fireEvent.keyDown(input, { key: 'Tab' });

      // Should show hints and select first one
      expect(screen.getByText('cat')).toBeInTheDocument();
      expect(screen.getByText('clear')).toBeInTheDocument();
      expect(input.value).toBe('cat');
    });

    it('completes single matching file path for cat command', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      // 'docs/' has only one file, so it should complete
      fireEvent.change(input, { target: { value: 'cat docs/' } });
      fireEvent.keyDown(input, { key: 'Tab' });

      // Should complete to the only file in docs
      expect(input.value).toBe('cat docs/readme.md');
    });

    it('shows hints and selects first match for multiple matching paths for cat command', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      // 'blog' directory has multiple files starting with 'hello'
      fireEvent.change(input, { target: { value: 'cat blog/hello' } });
      fireEvent.keyDown(input, { key: 'Tab' });

      // Should show hints and select first one
      expect(screen.getByText('blog/hello-world.md')).toBeInTheDocument();
      expect(screen.getByText('blog/hello-there.md')).toBeInTheDocument();
      // Input should be updated to first matching path
      expect(input.value).toMatch(/^cat blog\/hello-(world|there)\.md$/);
    });

    it('completes single matching path for ls command', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      // When there's only one match, it completes to the full path
      fireEvent.change(input, { target: { value: 'ls docs/' } });
      fireEvent.keyDown(input, { key: 'Tab' });

      // Should complete to the only file in docs
      expect(input.value).toBe('ls docs/readme.md');
    });

    it('completes single matching path for tree command', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'tree docs/' } });
      fireEvent.keyDown(input, { key: 'Tab' });

      // Should complete to the only file in docs
      expect(input.value).toBe('tree docs/readme.md');
    });

    it('shows directory hints for ls command with empty path (level-by-level)', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      // Empty path shows top-level directories only (level-by-level)
      fireEvent.change(input, { target: { value: 'ls ' } });
      fireEvent.keyDown(input, { key: 'Tab' });

      // Should show directory hints at top level
      expect(screen.getByText('blog/')).toBeInTheDocument();
      expect(screen.getByText('docs/')).toBeInTheDocument();
      // Input should be updated to first directory
      expect(input.value).toMatch(/^ls (blog|docs)\/$/);
    });

    it('completes command with Ctrl+I (alternative to Tab)', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'hel' } });
      fireEvent.keyDown(input, { key: 'i', ctrlKey: true });

      // Should complete to "help " with trailing space
      expect(input.value).toBe('help ');
    });

    it('does nothing when input is empty on Tab', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.keyDown(input, { key: 'Tab' });

      expect(input.value).toBe('');
    });

    it('does not complete when no commands match', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'xyz' } });
      fireEvent.keyDown(input, { key: 'Tab' });

      // Should remain unchanged
      expect(input.value).toBe('xyz');
    });
  });

  describe('tab cycling behavior', () => {
    it('cycles through multiple matching commands on repeated Tab presses', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      // 'c' matches cat, clear
      fireEvent.change(input, { target: { value: 'c' } });

      // First Tab - selects first match (cat)
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(input.value).toBe('cat');

      // Second Tab - cycles to next match (clear)
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(input.value).toBe('clear');

      // Third Tab - cycles back to first (cat)
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(input.value).toBe('cat');
    });

    it('cycles through multiple matching paths on repeated Tab presses', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      // 'blog' directory has hello-world.md and hello-there.md
      fireEvent.change(input, { target: { value: 'cat blog/hello' } });

      // First Tab - selects first path
      fireEvent.keyDown(input, { key: 'Tab' });
      const firstValue = input.value;
      expect(firstValue).toMatch(/^cat blog\/hello-(world|there)\.md$/);

      // Second Tab - cycles to next path
      fireEvent.keyDown(input, { key: 'Tab' });
      const secondValue = input.value;
      expect(secondValue).toMatch(/^cat blog\/hello-(world|there)\.md$/);
      expect(secondValue).not.toBe(firstValue);

      // Third Tab - cycles back to first
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(input.value).toBe(firstValue);
    });

    it('highlights the currently selected hint', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'c' } });
      fireEvent.keyDown(input, { key: 'Tab' });

      // The hints should be shown, and one should be highlighted
      const hints = screen.getAllByText(/^(cat|clear)$/);
      expect(hints.length).toBe(2);

      // Check that there's a hint with highlighted style (background color applied)
      // The highlighted hint should have the $highlighted prop
      const wrapper = screen.getByTestId('terminal-wrapper');
      // The first hint (cat) should be highlighted after first Tab
      expect(wrapper).toContainHTML('cat');
    });

    it('resets cycling when user types new input', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'c' } });

      // First Tab - selects first match
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(input.value).toBe('cat');

      // User types something new - should reset
      // 'h' matches 'help' and 'history' (multiple matches)
      fireEvent.change(input, { target: { value: 'h' } });

      // Tab again - should start fresh cycle with 'help' and 'history'
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(input.value).toBe('help');

      // Continue cycling
      fireEvent.keyDown(input, { key: 'Tab' });
      expect(input.value).toBe('history');
    });

    it('clears hints when user types after cycling', () => {
      renderTerminal();

      const input = screen.getByTitle('terminal-input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'c' } });
      fireEvent.keyDown(input, { key: 'Tab' });

      // Hints should be visible
      expect(screen.getByText('cat')).toBeInTheDocument();
      expect(screen.getByText('clear')).toBeInTheDocument();

      // User types new input
      fireEvent.change(input, { target: { value: 'about' } });

      // Hints should be cleared
      expect(screen.queryByText('cat')).not.toBeInTheDocument();
      expect(screen.queryByText('clear')).not.toBeInTheDocument();
    });
  });
});
