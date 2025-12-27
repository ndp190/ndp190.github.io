import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import theme from '../components/styles/themes';
import Language from '../components/commands/Language';
import { termContext } from '../components/Terminal';
import { languageContext } from '../pages/_app';
import { Language as LanguageType } from '../utils/useLanguage';

const defaultTheme = theme.dark;

interface RenderLanguageOptions {
  arg?: string[];
  history?: string[];
  rerender?: boolean;
  language?: LanguageType;
  setLanguage?: jest.Mock;
}

const renderLanguage = (options: RenderLanguageOptions = {}) => {
  const {
    arg = [],
    history = ['language'],
    rerender = false,
    language = 'en',
    setLanguage = jest.fn(),
  } = options;

  const termContextValue = {
    arg,
    history,
    rerender,
    index: 0,
    clearHistory: jest.fn(),
    executeCommand: jest.fn(),
  };

  return render(
    <ThemeProvider theme={defaultTheme}>
      <languageContext.Provider value={{ language, setLanguage }}>
        <termContext.Provider value={termContextValue}>
          <Language />
        </termContext.Provider>
      </languageContext.Provider>
    </ThemeProvider>
  );
};

describe('Language component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('display', () => {
    it('renders language options', () => {
      renderLanguage();
      expect(screen.getByTestId('language')).toBeInTheDocument();
      expect(screen.getByText(/en \(English\)/)).toBeInTheDocument();
      expect(screen.getByText(/vn \(Tiếng Việt\)/)).toBeInTheDocument();
    });

    it('shows current language with asterisk', () => {
      renderLanguage({ language: 'en' });
      expect(screen.getByText(/en \(English\) \*/)).toBeInTheDocument();
    });

    it('shows Vietnamese as current when selected', () => {
      renderLanguage({ language: 'vn' });
      expect(screen.getByText(/vn \(Tiếng Việt\) \*/)).toBeInTheDocument();
    });

    it('displays usage instructions', () => {
      renderLanguage();
      expect(screen.getByText(/Usage: language set/)).toBeInTheDocument();
      expect(screen.getByText(/language set vn/)).toBeInTheDocument();
    });
  });

  describe('language switching', () => {
    it('calls setLanguage when switching to Vietnamese', () => {
      const setLanguage = jest.fn();
      renderLanguage({
        arg: ['set', 'vn'],
        rerender: true,
        setLanguage,
      });

      expect(setLanguage).toHaveBeenCalledWith('vn');
    });

    it('calls setLanguage when switching to English', () => {
      const setLanguage = jest.fn();
      renderLanguage({
        arg: ['set', 'en'],
        language: 'vn',
        rerender: true,
        setLanguage,
      });

      expect(setLanguage).toHaveBeenCalledWith('en');
    });

    it('does not call setLanguage when rerender is false', () => {
      const setLanguage = jest.fn();
      renderLanguage({
        arg: ['set', 'vn'],
        rerender: false,
        setLanguage,
      });

      expect(setLanguage).not.toHaveBeenCalled();
    });
  });

  describe('invalid arguments', () => {
    it('shows usage for invalid action', () => {
      renderLanguage({ arg: ['invalid', 'en'] });
      expect(screen.getByText(/Usage: language set/)).toBeInTheDocument();
    });

    it('shows usage for invalid language code', () => {
      renderLanguage({ arg: ['set', 'fr'] });
      expect(screen.getByText(/Usage: language set/)).toBeInTheDocument();
    });

    it('shows usage for too many arguments', () => {
      renderLanguage({ arg: ['set', 'vn', 'extra'] });
      expect(screen.getByText(/Usage: language set/)).toBeInTheDocument();
    });

    it('shows usage for missing language code', () => {
      renderLanguage({ arg: ['set'] });
      expect(screen.getByText(/Usage: language set/)).toBeInTheDocument();
    });
  });
});
