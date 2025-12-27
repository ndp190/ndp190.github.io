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
```

No test framework is configured.

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

## Deployment

GitHub Actions workflow (`.github/workflows/nextjs.yml`) builds and exports static HTML on push to master, deploying to GitHub Pages.
