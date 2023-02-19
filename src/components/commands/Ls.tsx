import React from "react";
import { Wrapper } from "../styles/Output.styled";

interface Props {
  files: string[];
}

const Ls: React.FC<Props> = ({ files }) => {
  return (
    <Wrapper>
      <ul>
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    </Wrapper>
  );
};

export default Ls;

