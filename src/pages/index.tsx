import Terminal from "@/components/Terminal";
import { FileNode, readDirectory } from "@/utils/listFiles";
import { NextPage } from "next";
import { createContext } from "react";

interface HomeProps {
  allFileNode: FileNode;
}

export const getStaticProps = async () => {
  const allFileNode = readDirectory('public/terminal');

  return {
    props: {
      allFileNode,
    },
  };
};

export const homeContext = createContext<HomeProps>({
  allFileNode: {
    name: '',
    isDirectory: false,
  },
});

const Home: NextPage<HomeProps> = ({ allFileNode }) => {
  return (
    <homeContext.Provider value={{ allFileNode }}>
      <Terminal />
    </homeContext.Provider>
  );
}

export default Home;
