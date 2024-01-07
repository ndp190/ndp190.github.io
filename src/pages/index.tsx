import Terminal from "@/components/Terminal";
import { FileNode, readDirectory } from "@/utils/listFiles";
import { NextPage } from "next";
import { createContext } from "react";

interface HomeProps {
  allFileNode: FileNode;
  currentFileNode: FileNode;
}

export const getStaticProps = async () => {
  const allFileNode = readDirectory('public/terminal');
  const currentFileNode = allFileNode;

  return {
    props: {
      allFileNode,
      currentFileNode,
    },
  };
};

export const homeContext = createContext<HomeProps>({
  allFileNode: {
    name: '',
    isDirectory: false,
  },
  currentFileNode: {
    name: '',
    isDirectory: false,
  },
});

const Home: NextPage<HomeProps> = ({ allFileNode, currentFileNode }) => {
  return (
    <homeContext.Provider value={{ allFileNode, currentFileNode }}>
      <Terminal />
    </homeContext.Provider>
  );
}

export default Home;
