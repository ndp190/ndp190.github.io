# Create Terminal Command Skill

This skill creates new terminal commands for the interactive portfolio website.

## Project Structure

Commands are located in:
- `src/components/commands/` - Command components
- `src/__tests__/` - Test files

Related files that need updates:
- `src/components/Terminal.tsx` - Command registration and autocomplete
- `src/components/Output.tsx` - Command routing

## Steps to Create a New Command

### 1. Create the Command Component

Create `src/components/commands/{CommandName}.tsx`:

```tsx
import { useContext, useEffect } from "react";
import { termContext } from "../Terminal";
import { UsageDiv } from "../styles/Output.styled";
import { checkRedirect, getCurrentCmdArry } from "../../utils/funcs";

const {CommandName}: React.FC = () => {
  const { arg, history, rerender, index } = useContext(termContext);
  const currentCommand = getCurrentCmdArry(history);

  // For commands with 'go' action that opens URLs
  useEffect(() => {
    if (checkRedirect(rerender, currentCommand, "{commandname}")) {
      if (arg[0] === "go") {
        // Handle redirect logic
      }
    }
  }, [arg, rerender, currentCommand]);

  // Validate arguments - return usage if invalid
  if (arg.length > 0) {
    const validActions = ["go", "list"]; // Define valid subcommands
    const action = arg[0];

    if (!validActions.includes(action)) {
      return (
        <UsageDiv data-testid="{commandname}-usage">
          Usage: {commandname} &lt;action&gt; [args]
          <br />
          Actions: {validActions.join(", ")}
        </UsageDiv>
      );
    }
  }

  // Default output (no args)
  return (
    <div data-testid="{commandname}">
      {/* Command output here */}
    </div>
  );
};

export default {CommandName};
```

### 2. Register the Command in Terminal.tsx

Add to the `commands` array in `src/components/Terminal.tsx`:

```tsx
export const commands: Command = [
  // ... existing commands
  { cmd: "{commandname}", desc: "{description}", tab: {number} },
];
```

The `tab` value controls spacing in help output (typically 5-11 based on command length).

### 3. Add Command to Output.tsx

Import and add the component in `src/components/Output.tsx`:

```tsx
import {CommandName} from "./commands/{CommandName}";

// Add to specialCmds if command accepts arguments
const specialCmds = ["...", "{commandname}"];

// Add to the command map in the return statement
{
  // ... existing commands
  {commandname}: <{CommandName} />,
}
```

### 4. Add Autocomplete Support (if needed)

For commands with subcommands or arguments, add autocomplete logic in `Terminal.tsx` inside the `handleKeyDown` function, after the existing autocomplete handlers:

```tsx
// Handle {commandname} command autocomplete
if (inputParts[0] === "{commandname}") {
  const subcommand = inputParts[1] || "";

  // Autocomplete subcommand
  if (inputParts.length <= 2) {
    const subcommands = ["go", "list", "show"].filter(s =>
      s.startsWith(subcommand)
    );

    if (subcommands.length === 1) {
      setInputVal(`{commandname} ${subcommands[0]} `);
      setHints([]);
      return;
    } else if (subcommands.length > 1 && subcommand) {
      setHints(subcommands.map(s => `{commandname} ${s}`));
      return;
    }
  }

  // Autocomplete arguments for specific subcommands
  if (subcommand === "show") {
    const partialArg = inputParts[2] || "";
    const validArgs = ["item1", "item2", "item3"];
    const matches = validArgs.filter(a => a.startsWith(partialArg));

    if (matches.length === 1) {
      setInputVal(`{commandname} ${subcommand} ${matches[0]}`);
      setHints([]);
      return;
    } else if (matches.length > 1) {
      setHints(matches);
      return;
    }
  }
}
```

### 5. Create Test File

Create `src/__tests__/{CommandName}.test.tsx`:

```tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import { ThemeProvider } from "styled-components";
import theme from "../components/styles/themes";
import { termContext } from "../components/Terminal";
import {CommandName} from "../components/commands/{CommandName}";

const defaultTheme = theme.dark;

const renderWithContext = (
  component: React.ReactNode,
  contextValue: {
    arg?: string[];
    history?: string[];
    rerender?: boolean;
    index?: number;
  } = {}
) => {
  const defaultContext = {
    arg: [],
    history: ["{commandname}"],
    rerender: false,
    index: 0,
    clearHistory: jest.fn(),
    executeCommand: jest.fn(),
    ...contextValue,
  };

  return render(
    <ThemeProvider theme={defaultTheme}>
      <termContext.Provider value={defaultContext}>
        {component}
      </termContext.Provider>
    </ThemeProvider>
  );
};

describe("{CommandName} Command", () => {
  describe("Default output (no args)", () => {
    it("renders command output", () => {
      renderWithContext(<{CommandName} />);
      expect(screen.getByTestId("{commandname}")).toBeInTheDocument();
    });
  });

  describe("With arguments", () => {
    it("handles valid subcommand", () => {
      renderWithContext(<{CommandName} />, {
        arg: ["list"],
        history: ["{commandname} list"],
      });
      // Add assertions for list output
    });

    it("shows usage for invalid subcommand", () => {
      renderWithContext(<{CommandName} />, {
        arg: ["invalid"],
        history: ["{commandname} invalid"],
      });
      expect(screen.getByTestId("{commandname}-usage")).toBeInTheDocument();
    });
  });

  describe("Edge cases", () => {
    it("handles empty state gracefully", () => {
      // Test edge cases specific to your command
    });
  });
});
```

### 6. Run Tests

```bash
npm test -- --testPathPattern={CommandName}
npm test  # Run all tests
```

### 7. Build and Verify

```bash
npm run build
npm run dev  # Test manually
```

## Autocomplete Behavior Guidelines

To mimic terminal autocomplete behavior:

1. **Single match**: Auto-fill the complete value
2. **Multiple matches**: Show hints, then cycle through on repeated Tab
3. **No matches**: Do nothing (keep current input)
4. **Partial match**: Complete the common prefix

### Basic Pattern (show hints only):
```tsx
if (matches.length === 1) {
  // Single match - auto-complete
  setInputVal(`command ${matches[0]}`);
  setHints([]);
} else if (matches.length > 1) {
  // Multiple matches - show hints
  setHints(matches);
} else {
  // No matches - do nothing or clear hints
  setHints([]);
}
```

### Advanced Pattern (cycle through matches on repeated Tab):

To implement cycling behavior, you need to track the current hint index in state:

```tsx
// Add state in Terminal.tsx
const [hintIndex, setHintIndex] = useState(-1);

// Reset hint index when input changes
const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
  setRerender(false);
  setInputVal(e.target.value);
  setHintIndex(-1); // Reset cycling when input changes
}, []);

// In handleKeyDown, for Tab key:
if (matches.length === 1) {
  // Single match - auto-complete
  setInputVal(`command ${matches[0]}`);
  setHints([]);
  setHintIndex(-1);
} else if (matches.length > 1) {
  // Multiple matches - cycle through on repeated Tab
  if (hints.length > 0 && hints.toString() === matches.toString()) {
    // Same hints as before - cycle to next
    const nextIndex = (hintIndex + 1) % matches.length;
    setHintIndex(nextIndex);
    setInputVal(`command ${matches[nextIndex]}`);
  } else {
    // New hints - show them and start cycling
    setHints(matches);
    setHintIndex(0);
    setInputVal(`command ${matches[0]}`);
  }
}
```

### Cycling Behavior Rules:

1. **First Tab with multiple matches**: Show hints and select first match
2. **Subsequent Tabs**: Cycle to next match (wrap around to first after last)
3. **Input change**: Reset cycle index to -1
4. **Different matches**: Reset and start new cycle

Example flow:
```
Input: "command g"
Matches: ["go", "get", "grep"]

Tab 1: hints shown, input becomes "command go"
Tab 2: input becomes "command get"
Tab 3: input becomes "command grep"
Tab 4: input becomes "command go" (wraps around)
Type anything: cycle resets
```

## Styled Components

Common styled components available in `src/components/styles/Output.styled.tsx`:
- `UsageDiv` - For usage/error messages
- `OutputContainer` - Wrapper for command output

Create command-specific styles in `src/components/styles/{CommandName}.styled.tsx` if needed.

## Example Commands for Reference

- **Simple command**: `src/components/commands/About.tsx`
- **With arguments**: `src/components/commands/Themes.tsx`
- **With data fetching**: `src/components/commands/Bookmark.tsx`
- **File system**: `src/components/commands/Cat.tsx`, `src/components/commands/Ls.tsx`
