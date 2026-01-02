# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a personal portfolio website built as an interactive terminal emulator using Next.js. It's deployed to GitHub Pages at ndp190.github.io.

## Commands

```bash
npm run dev      # Start development server at localhost:3000
npm run build    # Production build
npm run lint     # Run ESLint
npm run start    # Start production server
npm test         # Run tests
npm run test:watch  # Run tests in watch mode
```

Tests are located in `src/__tests__/` using Jest and React Testing Library.

## Architecture

### Terminal Emulator Pattern

The site presents a terminal interface where users type commands to navigate content:

- `src/components/Terminal.tsx` - Main component handling input, command history, and keyboard shortcuts (Tab/Ctrl+I autocomplete, Ctrl+L clear, Arrow keys for history)
- `src/components/Output.tsx` - Dispatcher that routes commands to appropriate output components
- `src/components/commands/` - Individual components for each command (About, Help, Projects, etc.)

### State Management

- Theme context in `_app.tsx` with localStorage persistence via `src/utils/useTheme.ts`
- Terminal context in `Terminal.tsx` for input state and file tree data
- File tree read at build time via `getStaticProps` using `src/utils/listFiles.ts`

### Styling

Uses styled-components with 7 predefined themes (dark, light, blue-matrix, espresso, green-goblin, ubuntu, nikk). Theme definitions are in `src/components/styles/Themes.styled.tsx`.

### File Tree Feature

The `public/terminal/` directory structure is read at build time and passed to components via context. This enables the `ls` and `tree` commands to display a mock file system.

### Blog Feature

Blog posts are markdown files stored in `public/terminal/blog/`. The `cat` command renders markdown with full support for:
- Headers, lists, tables
- Code blocks with syntax highlighting
- Images (rendered inline)
- Links, blockquotes, bold/italic text

To add a new blog post, create a `.md` file in `public/terminal/blog/`.

## Testing Requirements

**IMPORTANT: Always write tests for code changes.**

### Unit Tests (Jest + React Testing Library)
- Location: `src/__tests__/`
- Run: `npm test`
- Write unit tests for:
  - New utility functions
  - Component logic changes
  - Context/state management changes

### UI/Integration Tests (Playwright)
- **Always use Playwright to verify UI changes work correctly**
- For any UI changes (new pages, component updates, styling):
  1. Start dev server: `npm run dev`
  2. Use Playwright browser tools to navigate and verify:
     - `browser_navigate` to visit pages
     - `browser_snapshot` to inspect page structure
     - `browser_click` to test interactions
     - `browser_console_messages` to check for errors
  3. Verify the feature works as expected before marking complete

### Testing Checklist
Before completing any task:
- [ ] Run `npm run build` to verify no TypeScript/build errors
- [ ] Run `npm test` to ensure existing tests pass
- [ ] For UI changes: Use Playwright to manually verify the feature works
- [ ] Write new tests if adding new functionality

## Deployment

GitHub Actions workflow (`.github/workflows/nextjs.yml`) builds and exports static HTML on push to master, deploying to GitHub Pages.
