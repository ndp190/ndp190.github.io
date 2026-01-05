import Clear from "./commands/Clear";
import Echo from "./commands/Echo";
import GeneralOutput from "./commands/GeneralOutput";
import Help from "./commands/Help";
import History from "./commands/History";
import Language from "./commands/Language";
import Themes from "./commands/Themes";
import { OutputContainer, UsageDiv } from "./styles/Output.styled";
import { termContext } from "./Terminal";
import { useContext } from "react";

type Props = {
  index: number;
  cmd: string;
};

// Placeholder components - will be implemented in later phases
const Placeholder: React.FC<{ name: string }> = ({ name }) => (
  <GeneralOutput>{name} command - coming soon</GeneralOutput>
);

const Output: React.FC<Props> = ({ index, cmd }) => {
  const { arg } = useContext(termContext);

  const specialCmds = ["bookmark", "socials", "themes", "language", "echo", "cat", "ls"];

  // return 'Usage: <cmd>' if command arg is not valid
  if (!specialCmds.includes(cmd) && arg.length > 0)
    return <UsageDiv data-testid="usage-output">Usage: {cmd}</UsageDiv>;

  return (
    <OutputContainer data-testid={index === 0 ? "latest-output" : null}>
      {
        {
          about: <Placeholder name="About" />,
          bookmark: <Placeholder name="Bookmark" />,
          cat: <Placeholder name="Cat" />,
          clear: <Clear />,
          echo: <Echo />,
          education: <Placeholder name="Education" />,
          email: <Placeholder name="Email" />,
          gui: <Placeholder name="Gui" />,
          help: <Help />,
          history: <History />,
          language: <Language />,
          pwd: <GeneralOutput>/home/nikk</GeneralOutput>,
          socials: <Placeholder name="Socials" />,
          themes: <Themes />,
          welcome: <Placeholder name="Welcome" />,
          whoami: <GeneralOutput>visitor</GeneralOutput>,
          ls: <Placeholder name="Ls" />,
          tree: <Placeholder name="Tree" />,
        }[cmd]
      }
    </OutputContainer>
  );
};

export default Output;
