import { Wrapper } from "../styles/Output.styled";

interface Props {
  children: React.ReactNode;
}

const GeneralOutput: React.FC<Props> = ({ children }) => {
  return <Wrapper>{children}</Wrapper>;
};

export default GeneralOutput;
