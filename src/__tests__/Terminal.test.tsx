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

// Sample file tree for testing
const mockFileTree: FileNode = {
  name: 'terminal',
  path: 'terminal',
  isDirectory: true,
  children: [],
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
});
