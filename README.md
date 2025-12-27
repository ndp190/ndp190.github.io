# ndp190.github.io

A personal portfolio website built as an interactive terminal emulator using Next.js. Visit it live at [ndp190.github.io](https://ndp190.github.io).

## Features

- Interactive terminal interface with command history
- Tab autocomplete for commands
- Multiple color themes (dark, light, blue-matrix, espresso, green-goblin, ubuntu, nikk)
- Mock file system navigation with `ls` and `tree` commands
- Blog support with markdown rendering via `cat` command

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the terminal interface.

## Available Commands

Type `help` in the terminal to see all available commands.

### Blog

View blog posts using the `cat` command:

```bash
cat blog/hello-world.md
cat blog/terminal-tips.md
```

Or access directly via URL:
- [/blog/hello-world](https://ndp190.github.io/blog/hello-world)
- [/blog/terminal-tips](https://ndp190.github.io/blog/terminal-tips)

Blog posts are stored as markdown files in `public/terminal/blog/`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run start` | Start production server |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |

## Architecture

- **Terminal.tsx** - Main component handling input, command history, and keyboard shortcuts
- **Output.tsx** - Routes commands to appropriate output components
- **commands/** - Individual components for each command
- **Themes.styled.tsx** - Theme definitions with 7 color schemes

## Deployment

Automatically deployed to GitHub Pages via GitHub Actions on push to master.
