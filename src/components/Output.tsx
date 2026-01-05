import About from "./commands/About";
import Bookmark from "./commands/Bookmark";
import Cat from "./commands/Cat";
import Clear from "./commands/Clear";
import Echo from "./commands/Echo";
import GeneralOutput from "./commands/GeneralOutput";
import Help from "./commands/Help";
import History from "./commands/History";
import Language from "./commands/Language";
import Ls from "./commands/Ls";
import Themes from "./commands/Themes";
import Tree from "./commands/Tree";
import { OutputContainer, UsageDiv } from "./styles/Output.styled";
import { termContext } from "./Terminal";
import { useContext } from "react";

type Props = {
  index: number;
  cmd: string;
};

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
          about: <About />,
          bookmark: <Bookmark />,
          cat: <Cat />,
          clear: <Clear />,
          echo: <Echo />,
          education: <GeneralOutput>Education command - coming soon</GeneralOutput>,
          email: <GeneralOutput>Opening mailto:ndp190@gmail.com...</GeneralOutput>,
          gui: <GeneralOutput>GUI command - coming soon</GeneralOutput>,
          help: <Help />,
          history: <History />,
          language: <Language />,
          pwd: <GeneralOutput>/home/nikk</GeneralOutput>,
          socials: <GeneralOutput>Socials command - coming soon</GeneralOutput>,
          themes: <Themes />,
          whoami: <GeneralOutput>visitor</GeneralOutput>,
          ls: <Ls />,
          tree: <Tree />,
        }[cmd]
      }
    </OutputContainer>
  );
};

export default Output;
