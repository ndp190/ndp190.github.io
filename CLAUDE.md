# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a personal portfolio website built as an interactive terminal emulator using Vite + React. It's deployed to GitHub Pages at ndp190.github.io.

## Commands

```bash
npm run dev      # Start development server at localhost:3000
npm run build    # Production build (outputs to dist/)
npm run preview  # Preview production build
npm test         # Run tests (Vitest)
npm run test:ui  # Run tests with UI
```

Tests are located in `src/__tests__/` using Vitest and React Testing Library.

## Architecture

### Terminal Emulator Pattern

The site presents a terminal interface where users type commands to navigate content:

- `src/components/Terminal.tsx` - Main component handling input, command history, and keyboard shortcuts (Tab/Ctrl+I autocomplete, Ctrl+L clear, Arrow keys for history)
- `src/components/Output.tsx` - Dispatcher that routes commands to appropriate output components
- `src/components/commands/` - Individual components for each command (About, Help, Bookmark, etc.)

### State Management

- Theme context via `src/contexts/ThemeContext.tsx` with localStorage persistence
- Language context via `src/contexts/LanguageContext.tsx`
- Home context via `src/contexts/HomeContext.tsx` for file tree and bookmarks data
- File tree generated at build time via `scripts/generate-data.ts`

### Styling

Uses styled-components with 7 predefined themes (dark, light, blue-matrix, espresso, green-goblin, ubuntu, nikk). Theme definitions are in `src/components/styles/Themes.styled.tsx`.

### File Tree Feature

The `public/terminal/` directory structure is read at build time by `scripts/generate-data.ts` and saved to `src/data/fileTree.json`. This enables the `ls` and `tree` commands to display a mock file system.

### Blog Feature

Blog posts are markdown files stored in `public/terminal/blog/`. The `cat` command renders markdown with full support for:
- Headers, lists, tables
- Code blocks with syntax highlighting
- Images (rendered inline)
- Links, blockquotes, bold/italic text

To add a new blog post, create a `.md` file in `public/terminal/blog/`.

### Bookmark Feature

Bookmarks are fetched from R2 storage at runtime. The bookmark command displays saved articles with reading progress and annotations.

### Routing

Uses react-router-dom for client-side routing:
- `/` - Main terminal (home page)
- `/blog/:slug` - Blog post pages
- `/bookmark/:id` - Bookmark pages

## Testing Requirements

**IMPORTANT: Always write tests for code changes.**

### Unit Tests (Vitest + React Testing Library)
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
  2. Use Playwright browser tools to navigate and verify
  3. Verify the feature works as expected before marking complete

### Testing Checklist
Before completing any task:
- [ ] Run `npm run build` to verify no TypeScript/build errors
- [ ] Run `npm test` to ensure existing tests pass
- [ ] For UI changes: Use Playwright to manually verify the feature works
- [ ] Write new tests if adding new functionality

## Deployment

GitHub Actions workflow (`.github/workflows/vite.yml`) builds and deploys static HTML on push to master to GitHub Pages.

## Build-time Data Generation

Run `npm run generate-data` to regenerate `src/data/fileTree.json` and `src/data/translations.json` from the `public/` directory. This runs automatically before build.
