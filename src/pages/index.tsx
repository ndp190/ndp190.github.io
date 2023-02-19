import Terminal from "@/components/Terminal";
import { listFiles } from "@/utils/listFiles";
import { NextPage } from "next";

interface HomeProps {
  files: string[];
}

export const getServerSideProps = async () => {
  const files = listFiles('terminal');

  return {
    props: {
      files,
    },
  };
};

const Home: NextPage<HomeProps> = ({ files }) => {
  return (
    <>
      <Terminal files={files} />
    </>
  );
};

export default Home;
