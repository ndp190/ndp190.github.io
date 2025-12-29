import { useContext, useEffect } from "react";
import { ProjectsIntro } from "../styles/Projects.styled";
import { Cmd, CmdDesc, CmdList, HelpWrapper } from "../styles/Help.styled";
import { generateTabs, getCurrentCmdArry } from "../../utils/funcs";
import { termContext } from "../Terminal";
import Usage from "../Usage";

const validSocialIds = () => socials.map(s => String(s.id));

const Socials: React.FC = () => {
  const { arg, history, rerender } = useContext(termContext);

  /* ===== get current command ===== */
  const currentCommand = getCurrentCmdArry(history);

  /* ===== check current command makes redirect ===== */
  useEffect(() => {
    if (
      rerender &&
      currentCommand[0] === "socials" &&
      currentCommand[1] === "go" &&
      currentCommand.length === 3 &&
      validSocialIds().includes(currentCommand[2])
    ) {
      const targetId = parseInt(currentCommand[2]);
      const social = socials.find(s => s.id === targetId);
      if (social) {
        window.open(social.url, "_blank");
      }
    }
  }, [arg, rerender, currentCommand]);

  /* ===== check arg is valid ===== */
  const isInvalidArg = () =>
    arg[0] !== "go" || !validSocialIds().includes(arg[1]) || arg.length > 2;

  const checkArg = () => (isInvalidArg() ? <Usage cmd="socials" /> : null);

  return arg.length > 0 || arg.length > 2 ? (
    checkArg()
  ) : (
    <HelpWrapper data-testid="socials">
      <ProjectsIntro>Here are my social links</ProjectsIntro>
      {socials.map(({ id, title, url, tab }) => (
        <CmdList key={title}>
          <Cmd>{`${id}. ${title}`}</Cmd>
          {generateTabs(tab)}
          <CmdDesc>- {url}</CmdDesc>
        </CmdList>
      ))}
      <Usage cmd="socials" marginY />
    </HelpWrapper>
  );
};

const socials = [
  {
    id: 1,
    title: "GitHub",
    url: "https://github.com/satnaing",
    tab: 3,
  },
  {
    id: 2,
    title: "Dev.to",
    url: "https://dev.to/satnaing",
    tab: 3,
  },
  {
    id: 3,
    title: "Facebook",
    url: "https://www.facebook.com/satnaing.dev",
    tab: 1,
  },
  {
    id: 4,
    title: "Instagram",
    url: "https://instagram.com/satnaing.dev",
    tab: 0,
  },
];

export default Socials;
