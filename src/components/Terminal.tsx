import React, {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import _ from "lodash";
import Output from "./Output";
import TermInfo from "./TermInfo";
import {
  CmdNotFound,
  Empty,
  Form,
  Hints,
  Input,
  KeyboardButton,
  MobileBr,
  MobileSpan,
  Wrapper,
} from "./styles/Terminal.styled";
import { argTab } from "../utils/funcs";
import { useHomeContext } from "@/contexts";
import { getMatchingPaths } from "@/utils/fileUtils";

type Command = {
  cmd: string;
  desc: string;
  tab: number;
}[];

export const commands: Command = [
  { cmd: "about", desc: "about me and this site", tab: 8 },
  { cmd: "cat", desc: "display file contents", tab: 10 },
  { cmd: "help", desc: "check available commands", tab: 9 },
  { cmd: "themes", desc: "check available themes", tab: 7 },
  { cmd: "language", desc: "switch language (en/vn)", tab: 5 },
  { cmd: "clear", desc: "clear the terminal", tab: 8 },
  { cmd: "echo", desc: "print out anything", tab: 9 },
  { cmd: "history", desc: "view command history", tab: 6 },
  { cmd: "pwd", desc: "print current working directory", tab: 10 },
  { cmd: "ls", desc: "list directory contents (-l for details)", tab: 11 },
  { cmd: "tree", desc: "list contents of directories in a tree-like format", tab: 9 },
];

interface Term {
  arg: string[];
  history: string[];
  rerender: boolean;
  index: number;
  clearHistory?: () => void;
  executeCommand?: (cmd: string) => void;
}


export const termContext = createContext<Term>({
  arg: [],
  history: [],
  rerender: false,
  index: 0,
});


interface TerminalProps {
  initialCommand?: string;
}

const Terminal: React.FC<TerminalProps> = ({ initialCommand = "about" }) => {
  const containerRef = useRef(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { allFileNode } = useHomeContext();

  const [inputVal, setInputVal] = useState("");
  const [cmdHistory, setCmdHistory] = useState<string[]>([initialCommand]);
  const [rerender, setRerender] = useState(false);
  const [hints, setHints] = useState<string[]>([]);
  const [hintIndex, setHintIndex] = useState(-1); // -1 means no hint selected, 0+ means cycling through hints
  const [originalInput, setOriginalInput] = useState(""); // Store input before cycling
  const [pointer, setPointer] = useState(-1);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  // Detect mobile device - only after mount to avoid hydration mismatch
  useEffect(() => {
    setHasMounted(true);
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 550);
    };
    checkMobile();
    // Blur input on mobile to prevent keyboard popup on initial load
    if (window.innerWidth < 550) {
      inputRef.current?.blur();
      setIsInputFocused(false);
    }
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Check if form is in viewport
  const isFormInViewport = useCallback(() => {
    if (!formRef.current) return false;
    const rect = formRef.current.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight)
    );
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setRerender(false);
      setInputVal(e.target.value);
      // Reset hint cycling when user types manually
      setHintIndex(-1);
      setOriginalInput("");
      setHints([]);
    },
    []
  );

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setCmdHistory([inputVal, ...cmdHistory]);
    setInputVal("");
    setRerender(true);
    setHints([]);
    setPointer(-1);
  };

  const clearHistory = () => {
    setCmdHistory([]);
    setHints([]);
  };

  const executeCommand = (cmd: string) => {
    setCmdHistory([cmd, ...cmdHistory]);
    setInputVal("");
    setRerender(true);
    setHints([]);
    setPointer(-1);
  };

  // Track mouse position to detect text selection (drag)
  const mouseDownPos = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    mouseDownPos.current = { x: e.clientX, y: e.clientY };
    // Mark as potentially dragging - will be confirmed on mouseup
    isDragging.current = true;
  }, []);

  // focus on input when terminal is clicked (only on desktop or when input is in view on mobile)
  const handleMouseUp = useCallback((e: MouseEvent) => {
    // Check if this was a drag (mouse moved significantly)
    let didDrag = false;
    if (mouseDownPos.current) {
      const dx = Math.abs(e.clientX - mouseDownPos.current.x);
      const dy = Math.abs(e.clientY - mouseDownPos.current.y);
      didDrag = dx > 5 || dy > 5;
    }

    // Clear dragging state after a delay to allow selection to persist
    setTimeout(() => {
      isDragging.current = false;
    }, 150);

    if (!inputRef.current) return;

    // Don't focus if user dragged (was selecting)
    if (didDrag) {
      return;
    }

    // On mobile, only focus if the form is in viewport
    if (isMobile && !isFormInViewport()) return;

    // Use setTimeout to allow selection to complete before checking
    setTimeout(() => {
      // Don't focus if user has selected text
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) return;

      inputRef.current?.focus({ preventScroll: true });
    }, 10);
  }, [isMobile, isFormInViewport]);

  useEffect(() => {
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseDown, handleMouseUp]);

  // Handle keyboard button click - focus input and scroll to it
  const handleKeyboardButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    // Focus immediately (required for iOS to show keyboard)
    inputRef.current?.focus();
    // Then scroll to the form
    if (formRef.current) {
      formRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Keyboard Press
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    setRerender(false);
    const ctrlI = e.ctrlKey && e.key.toLowerCase() === "i";
    const ctrlL = e.ctrlKey && e.key.toLowerCase() === "l";
    const ctrlU = e.ctrlKey && e.key.toLowerCase() === "u";

    // if Tab or Ctrl + I
    if (e.key === "Tab" || ctrlI) {
      e.preventDefault();
      if (!inputVal) return;

      // If hints are already shown, cycle through them
      if (hints.length > 1) {
        const nextIndex = (hintIndex + 1) % hints.length;
        setHintIndex(nextIndex);

        // Store original input on first cycle
        if (hintIndex === -1) {
          setOriginalInput(inputVal);
        }

        // Update input with selected hint
        const inputParts = _.split(originalInput || inputVal, " ");
        const baseCmd = inputParts[0];

        // Check if this is a path hint (contains /)
        if (hints[nextIndex].includes("/")) {
          setInputVal(`${baseCmd} ${hints[nextIndex]}`);
        } else {
          // Command hint
          setInputVal(hints[nextIndex]);
        }
        return;
      }

      const inputParts = _.split(inputVal, " ");
      const baseCmd = inputParts[0];

      // Handle path autocomplete for cat, ls, tree commands
      if (["cat", "ls", "tree"].includes(baseCmd) && inputParts.length >= 1) {
        const partialPath = inputParts[1] || "";
        const matchingPaths = getMatchingPaths(allFileNode, partialPath);

        if (matchingPaths.length === 1) {
          setInputVal(`${baseCmd} ${matchingPaths[0]}`);
          setHints([]);
          setHintIndex(-1);
          setOriginalInput("");
          return;
        } else if (matchingPaths.length > 1) {
          setHints(matchingPaths);
          setHintIndex(0);
          setOriginalInput(inputVal);
          setInputVal(`${baseCmd} ${matchingPaths[0]}`);
          return;
        }
        // If no paths match but we have a partial path, don't try command completion
        if (partialPath) {
          setHints([]);
          setHintIndex(-1);
          setOriginalInput("");
          return;
        }
      }

      // Command autocomplete
      let hintsCmds: string[] = [];
      commands.forEach(({ cmd }) => {
        if (_.startsWith(cmd, inputVal)) {
          hintsCmds = [...hintsCmds, cmd];
        }
      });

      const returnedHints = argTab(inputVal, setInputVal, setHints, hintsCmds);
      hintsCmds = returnedHints ? [...hintsCmds, ...returnedHints] : hintsCmds;

      // if there are many commands to autocomplete
      if (hintsCmds.length > 1) {
        setHints(hintsCmds);
        setHintIndex(0);
        setOriginalInput(inputVal);
        setInputVal(hintsCmds[0]);
      }
      // if only one command to autocomplete - complete it with a trailing space
      else if (hintsCmds.length === 1) {
        const currentCmd = _.split(inputVal, " ");
        if (currentCmd.length === 1) {
          // Single command - add trailing space for easy argument input
          setInputVal(`${hintsCmds[0]} `);
        } else {
          // Command with arguments (e.g., themes set dark)
          setInputVal(`${currentCmd[0]} ${currentCmd[1]} ${hintsCmds[0]}`);
        }
        setHints([]);
        setHintIndex(-1);
        setOriginalInput("");
      }
    }

    // if Ctrl + U
    if (ctrlU) {
      setInputVal('');
    }

    // if Ctrl + L
    if (ctrlL) {
      clearHistory();
    }

    // Go previous cmd
    if (e.key === "ArrowUp") {
      if (pointer >= cmdHistory.length) return;

      if (pointer + 1 === cmdHistory.length) return;

      setInputVal(cmdHistory[pointer + 1]);
      setPointer(prevState => prevState + 1);
      inputRef?.current?.blur();
    }

    // Go next cmd
    if (e.key === "ArrowDown") {
      if (pointer < 0) return;

      if (pointer === 0) {
        setInputVal("");
        setPointer(-1);
        return;
      }

      setInputVal(cmdHistory[pointer - 1]);
      setPointer(prevState => prevState - 1);
      inputRef?.current?.blur();
    }
  };

  // For caret position at the end (only on desktop or when already focused)
  useEffect(() => {
    if (!hasMounted) return;
    const timer = setTimeout(() => {
      // On mobile, don't auto-focus unless already focused
      if (isMobile && !isInputFocused) return;
      // Don't steal focus if user is dragging or just dragged (selecting text)
      if (isDragging.current) return;
      // Don't steal focus if user has selected text
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) return;
      inputRef?.current?.focus({ preventScroll: true });
    }, 1);
    return () => clearTimeout(timer);
  }, [inputRef, inputVal, pointer, isMobile, isInputFocused, hasMounted]);

  return (
    <Wrapper data-testid="terminal-wrapper" ref={containerRef}>
      {hints.length > 1 && (
        <div>
          {hints.map((hCmd, idx) => (
            <Hints key={hCmd} $highlighted={idx === hintIndex}>{hCmd}</Hints>
          ))}
        </div>
      )}
      <Form onSubmit={handleSubmit} ref={formRef}>
        <label htmlFor="terminal-input">
          <TermInfo /> <MobileBr />
          <MobileSpan>&#62;</MobileSpan>
        </label>
        <Input
          title="terminal-input"
          type="text"
          id="terminal-input"
          autoComplete="off"
          spellCheck="false"
          autoFocus
          autoCapitalize="off"
          ref={inputRef}
          value={inputVal}
          onKeyDown={handleKeyDown}
          onChange={handleChange}
          onFocus={() => setIsInputFocused(true)}
          onBlur={() => setIsInputFocused(false)}
        />
      </Form>

      {cmdHistory.map((cmdH, index) => {
        const commandArray = _.split(_.trim(cmdH), " ");
        const validCommand = _.find(commands, { cmd: commandArray[0] });
        const contextValue = {
          arg: _.drop(commandArray),
          history: cmdHistory,
          rerender,
          index,
          clearHistory,
          executeCommand,
        };
        // Use stable key: position from end stays constant as new commands are prepended
        const stableKey = `${cmdHistory.length - index}-${cmdH}`;
        return (
          <div key={stableKey}>
            <div>
              <TermInfo />
              <MobileBr />
              <MobileSpan>&#62;</MobileSpan>
              <span data-testid="input-command">{cmdH}</span>
            </div>
            {validCommand ? (
              <termContext.Provider value={contextValue}>
                <Output index={index} cmd={commandArray[0]} />
              </termContext.Provider>
            ) : cmdH === "" ? (
              <Empty />
            ) : (
              <CmdNotFound data-testid={`not-found-${index}`}>
                command not found: {cmdH}
              </CmdNotFound>
            )}
          </div>
        );
      })}
      {hasMounted && isMobile && !isInputFocused && (
        <KeyboardButton
          onClick={handleKeyboardButtonClick}
          aria-label="Go to terminal prompt"
          type="button"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="4 17 10 11 4 5" />
            <line x1="12" y1="19" x2="20" y2="19" />
          </svg>
        </KeyboardButton>
      )}
    </Wrapper>
  );
};

export default Terminal;
