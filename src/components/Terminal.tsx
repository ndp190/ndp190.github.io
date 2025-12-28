import React, {
  createContext,
  useCallback,
  useContext,
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
import { homeContext } from "@/pages";
import { getMatchingPaths } from "@/utils/fileUtils";
import { fetchBookmarkManifest } from "@/utils/bookmarkService";
import type { BookmarkManifest } from "@/types/bookmark";

type Command = {
  cmd: string;
  desc: string;
  tab: number;
}[];

export const commands: Command = [
  { cmd: "about", desc: "about me", tab: 8 },
  { cmd: "bookmark", desc: "view saved articles", tab: 5 },
  { cmd: "cat", desc: "display file contents", tab: 10 },
  { cmd: "welcome", desc: "display hero section", tab: 6 },
  { cmd: "help", desc: "check available commands", tab: 9 },
  { cmd: "themes", desc: "check available themes", tab: 7 },
  { cmd: "language", desc: "switch language (en/vn)", tab: 5 },
  { cmd: "clear", desc: "clear the terminal", tab: 8 },
  { cmd: "echo", desc: "print out anything", tab: 9 },
  // { cmd: "education", desc: "my education background", tab: 4 },
  // { cmd: "email", desc: "send an email to me", tab: 8 },
  // { cmd: "gui", desc: "go to my portfolio in GUI", tab: 10 },
  { cmd: "history", desc: "view command history", tab: 6 },
  // { cmd: "projects", desc: "view projects that I've coded", tab: 5 },
  { cmd: "pwd", desc: "print current working directory", tab: 10 },
  { cmd: "ls", desc: "list directory contents (-l for details)", tab: 11 },
  { cmd: "tree", desc: "list contents of directories in a tree-like format", tab: 9 },
  // { cmd: "socials", desc: "check out my social accounts", tab: 6 },
  // { cmd: "whoami", desc: "about current user", tab: 7 },
];

interface Term {
  arg: string[];
  history: string[];
  rerender: boolean;
  index: number;
  clearHistory?: () => void;
  executeCommand?: (cmd: string) => void;
};


export const termContext = createContext<Term>({
  arg: [],
  history: [],
  rerender: false,
  index: 0,
});


interface TerminalProps {
  initialCommand?: string;
}

const Terminal: React.FC<TerminalProps> = ({ initialCommand = "welcome" }) => {
  const containerRef = useRef(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { allFileNode } = useContext(homeContext);

  const [inputVal, setInputVal] = useState("");
  const [cmdHistory, setCmdHistory] = useState<string[]>([initialCommand]);
  const [rerender, setRerender] = useState(false);
  const [hints, setHints] = useState<string[]>([]);
  const [pointer, setPointer] = useState(-1);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [bookmarkManifest, setBookmarkManifest] = useState<BookmarkManifest | null>(null);

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

  // Load bookmark manifest for autocomplete
  useEffect(() => {
    fetchBookmarkManifest()
      .then(setBookmarkManifest)
      .catch(() => {}); // Silently fail - autocomplete just won't work
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
    },
    [inputVal]
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

  // focus on input when terminal is clicked (only on desktop or when input is in view on mobile)
  const handleDivClick = useCallback(() => {
    if (!inputRef.current) return;
    // On mobile, only focus if the form is in viewport
    if (isMobile && !isFormInViewport()) return;
    inputRef.current.focus({ preventScroll: true });
  }, [isMobile, isFormInViewport]);

  useEffect(() => {
    document.addEventListener("click", handleDivClick);
    return () => {
      document.removeEventListener("click", handleDivClick);
    };
  }, [handleDivClick]);

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

      let hintsCmds: string[] = [];
      commands.forEach(({ cmd }) => {
        if (_.startsWith(cmd, inputVal)) {
          hintsCmds = [...hintsCmds, cmd];
        }
      });

      // Handle cat command autocomplete
      const inputParts = _.split(inputVal, " ");
      if (inputParts[0] === "cat") {
        const partialPath = inputParts[1] || "";
        const matchingPaths = getMatchingPaths(allFileNode, partialPath);

        if (matchingPaths.length === 1) {
          setInputVal(`cat ${matchingPaths[0]}`);
          setHints([]);
          return;
        } else if (matchingPaths.length > 1) {
          setHints(matchingPaths);
          return;
        }
      }

      // Handle bookmark command autocomplete
      if (inputParts[0] === "bookmark" && bookmarkManifest) {
        const subcommand = inputParts[1] || "";
        const partialId = inputParts[2] || "";

        // Autocomplete subcommand (go/cat)
        if (inputParts.length <= 2 && !["go", "cat"].includes(subcommand)) {
          const subcommands = ["go", "cat"].filter(s => s.startsWith(subcommand));
          if (subcommands.length === 1) {
            setInputVal(`bookmark ${subcommands[0]} `);
            setHints([]);
            return;
          } else if (subcommands.length > 1 && subcommand) {
            setHints(subcommands.map(s => `bookmark ${s}`));
            return;
          }
        }

        // Autocomplete bookmark ID with title
        if (["go", "cat"].includes(subcommand)) {
          const truncate = (str: string, len: number) =>
            str.length > len ? str.slice(0, len) + "..." : str;

          const matchingBookmarks = bookmarkManifest.bookmarks
            .filter(b => String(b.id).startsWith(partialId))
            .map(b => `${b.id}. ${truncate(b.title, 50)}`);

          if (matchingBookmarks.length === 1) {
            const id = matchingBookmarks[0].split(".")[0];
            setInputVal(`bookmark ${subcommand} ${id}`);
            setHints([]);
            return;
          } else if (matchingBookmarks.length > 1) {
            setHints(matchingBookmarks);
            return;
          }
        }
      }

      const returnedHints = argTab(inputVal, setInputVal, setHints, hintsCmds);
      hintsCmds = returnedHints ? [...hintsCmds, ...returnedHints] : hintsCmds;

      // if there are many command to autocomplete
      if (hintsCmds.length > 1) {
        setHints(hintsCmds);
      }
      // if only one command to autocomplete
      else if (hintsCmds.length === 1) {
        const currentCmd = _.split(inputVal, " ");
        setInputVal(
          currentCmd.length !== 1
            ? `${currentCmd[0]} ${currentCmd[1]} ${hintsCmds[0]}`
            : hintsCmds[0]
        );

        setHints([]);
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
      inputRef?.current?.focus({ preventScroll: true });
    }, 1);
    return () => clearTimeout(timer);
  }, [inputRef, inputVal, pointer, isMobile, isInputFocused, hasMounted]);

  return (
    <Wrapper data-testid="terminal-wrapper" ref={containerRef}>
      {hints.length > 1 && (
        <div>
          {hints.map(hCmd => (
            <Hints key={hCmd}>{hCmd}</Hints>
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
