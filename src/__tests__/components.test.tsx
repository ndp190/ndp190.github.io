import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from 'styled-components';
import theme from '../components/styles/themes';
import Help from '../components/commands/Help';
import GeneralOutput from '../components/commands/GeneralOutput';
import { termContext } from '../components/Terminal';

const defaultTheme = theme.dark;

const renderWithTheme = (component: React.ReactNode) => {
  return render(
    <ThemeProvider theme={defaultTheme}>
      {component}
    </ThemeProvider>
  );
};

const renderWithContext = (component: React.ReactNode, contextValue = {}) => {
  const defaultContext = {
    arg: [],
    history: [],
    rerender: false,
    index: 0,
    clearHistory: jest.fn(),
  };

  return render(
    <ThemeProvider theme={defaultTheme}>
      <termContext.Provider value={{ ...defaultContext, ...contextValue }}>
        {component}
      </termContext.Provider>
    </ThemeProvider>
  );
};

describe('Help component', () => {
  it('renders help section', () => {
    renderWithTheme(<Help />);
    expect(screen.getByTestId('help')).toBeInTheDocument();
  });

  it('displays available commands', () => {
    renderWithTheme(<Help />);
    expect(screen.getByText('about')).toBeInTheDocument();
    expect(screen.getByText('help')).toBeInTheDocument();
    expect(screen.getByText('clear')).toBeInTheDocument();
  });

  it('displays keyboard shortcuts', () => {
    renderWithTheme(<Help />);
    expect(screen.getByText(/Tab or Ctrl \+ i/)).toBeInTheDocument();
    expect(screen.getByText(/Up Arrow/)).toBeInTheDocument();
    expect(screen.getByText(/Ctrl \+ l/)).toBeInTheDocument();
  });
});

describe('GeneralOutput component', () => {
  it('renders children content', () => {
    renderWithTheme(<GeneralOutput>test output</GeneralOutput>);
    expect(screen.getByText('test output')).toBeInTheDocument();
  });

  it('renders with different content', () => {
    renderWithTheme(<GeneralOutput>/home/nikk</GeneralOutput>);
    expect(screen.getByText('/home/nikk')).toBeInTheDocument();
  });
});
