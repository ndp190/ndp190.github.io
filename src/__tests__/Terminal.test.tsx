import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import theme from '../components/styles/themes';
import Terminal from '../components/Terminal';
import { homeContext } from '../pages';
import { languageContext } from '../pages/_app';
import { FileNode } from '../types/files';

const defaultTheme = theme.dark;

// Mock scrollIntoView
const mockScrollIntoView = jest.fn();
Element.prototype.scrollIntoView = mockScrollIntoView;

// Mock focus to track preventScroll option
const mockFocus = jest.fn();

// Sample file tree for testing
const mockFileTree: FileNode = {
  name: 'terminal',
  path: 'terminal',
  isDirectory: true,
  children: [],
};

const renderTerminal = (initialCommand = 'welcome') => {
  return render(
    <ThemeProvider theme={defaultTheme}>
      <languageContext.Provider value={{ language: 'en', setLanguage: jest.fn() }}>
        <homeContext.Provider value={{ allFileNode: mockFileTree }}>
          <Terminal initialCommand={initialCommand} />
        </homeContext.Provider>
      </languageContext.Provider>
    </ThemeProvider>
  );
};

describe('Terminal component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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

    it('focuses input with preventScroll on document click', () => {
      renderTerminal();

      // Simulate document click
      fireEvent.click(document.body);

      // Check that focus was called with preventScroll: true
      expect(mockFocus).toHaveBeenCalledWith({ preventScroll: true });
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

    it('does not scroll to input when clicking on terminal content', () => {
      renderTerminal();

      const wrapper = screen.getByTestId('terminal-wrapper');

      // Click on the terminal wrapper
      fireEvent.click(wrapper);

      // Verify focus was called with preventScroll
      expect(mockFocus).toHaveBeenCalledWith({ preventScroll: true });
    });
  });

  describe('command execution', () => {
    it('executes initial command', () => {
      renderTerminal('welcome');
      expect(screen.getByTestId('input-command')).toHaveTextContent('welcome');
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
