// import { checkThemeSwitch, getCurrentCmdArry } from "@/utils/funcs";
// import { useContext, useEffect } from "react";
// import { termContext } from "../Terminal";

import { homeContext } from "@/pages";
import { getCurrentCmdArry } from "@/utils/funcs";
import { useContext, useEffect } from "react";
import { Wrapper } from "../styles/Terminal.styled";
import { termContext } from "../Terminal";

const Cd = () => {
  const { history, rerender } = useContext(termContext);
  const { allFileNode } = useContext(homeContext);
  // TODO need to store current node

  /* ===== get current command ===== */
  const currentCommand = getCurrentCmdArry(history);

  /* ===== check current command makes redirect ===== */
  useEffect(() => {
    if (
      rerender && // is submitted
      currentCommand[0] === "cd" &&
      currentCommand.length === 2 // current command has one arg
    ) {
      console.log('in');
      // if directory not existed then show error
      // else redirect to that directory
        // set current node to that directory
    }
    // if (checkThemeSwitch(rerender, currentCommand, myThemes)) {
    //   themeSwitcher?.(theme[currentCommand[2]]);
    // }
  }, [rerender, currentCommand, allFileNode]);
  return (
    <Wrapper>
    </Wrapper>
  );
};

export default Cd;
