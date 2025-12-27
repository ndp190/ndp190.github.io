import '@testing-library/jest-dom';

// Mock react-markdown since it's ESM-only
jest.mock('react-markdown', () => {
  return function MockReactMarkdown({ children }) {
    return children;
  };
});

jest.mock('remark-gfm', () => {
  return function remarkGfm() {
    return {};
  };
});
