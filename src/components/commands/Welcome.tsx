import { useContext } from "react";
import {
  BlogLink,
  BlogTree,
  Cmd,
  HeroContainer,
  Link,
  PreImg,
  PreName,
  PreNameMobile,
  PreWrapper,
  Seperator,
} from "../styles/Welcome.styled";
import { homeContext } from "@/pages";
import { termContext } from "../Terminal";
import { FileNode } from "@/types/files";

const puns = [
 "Phuc and behold, a blog full of untold stories told.",
 "Phuc is the name, sharing my thoughts and musings is the game.",
 "Phuc your way through my blog, filled with fun facts and a unique spin.",
 "Phuc'n'Stuff, where my thoughts and ideas are enough.",
 "Phuc-tastic, sharing my journey through this blog fantastic.",
 "Phuc'ed up your day, with my blog in every way.",
 "Phuc-ing awesome, sharing my life with you, with this blog so positively gnarly dude.",
 "Phuc, Phuc, and away, read my blog for a bright new day.",
 "Phuc-ing amazing, this blog overflowing with creative brainstorming.",
 "Phuc'ed with words, sharing my life through this blog, with so many tales to be heard."
];
const pun = puns[Math.floor(Math.random() * puns.length)];

// Get blog posts from file tree
function getBlogPosts(node: FileNode): FileNode[] {
  if (node.name === 'blog' && node.isDirectory && node.children) {
    return node.children.filter(child => !child.isDirectory && child.name.endsWith('.md'));
  }
  if (node.children) {
    for (const child of node.children) {
      const posts = getBlogPosts(child);
      if (posts.length > 0) return posts;
    }
  }
  return [];
}

const Welcome: React.FC = () => {
  const { allFileNode } = useContext(homeContext);
  const { executeCommand } = useContext(termContext);
  const blogPosts = getBlogPosts(allFileNode);

  const handleBlogClick = (filePath: string) => {
    if (executeCommand) {
      executeCommand(`cat ${filePath}`);
    }
  };

  return (
    <HeroContainer data-testid="welcome">
      <div className="info-section">
        <PreName>
          {`
 ____ ____ ____ ____
||N |||i |||k |||k ||
||  |||  |||  |||  ||
|| P||| h||| u||| c||
||__|||__|||__|||__||
|/__\\|/__\\|/__\\|/__\\|

          `}
        </PreName>
        <PreWrapper>
          <PreNameMobile>
            {`
 ____ ____ ____ ____
||N |||i |||k |||k ||
||  |||  |||  |||  ||
|| P||| h||| u||| c||
||__|||__|||__|||__||
|/__\\|/__\\|/__\\|/__\\|

          `}
          </PreNameMobile>
        </PreWrapper>
        <div>{pun}</div>
        <Seperator>----</Seperator>
        {blogPosts.length > 0 && (
          <>
            <div>Recent blog posts:</div>
            <BlogTree>
              <div><span className="tree-line">blog/</span></div>
              {blogPosts.map((post, index) => {
                const isLast = index === blogPosts.length - 1;
                const prefix = isLast ? '└── ' : '├── ';
                const filePath = post.path.replace(/^terminal\//, '');
                return (
                  <div key={post.name}>
                    <span className="tree-line">{prefix}</span>
                    <BlogLink onClick={() => handleBlogClick(filePath)}>
                      {post.name}
                    </BlogLink>
                  </div>
                );
              })}
            </BlogTree>
            <Seperator>----</Seperator>
          </>
        )}
        <div>
          This project's source code can be found in {" "}
          <Link href="https://github.com/ndp190/ndp190.github.io">
            this project
          </Link>
          .
        </div>
        <div>
          and it using the code base from this{" "}
          <Link href="https://github.com/satnaing/terminal-portfolio">
            GitHub repo
          </Link>
          {" "}of Sat Naing.
        </div>
        <Seperator>----</Seperator>
        <div>
          For a list of available commands, type `<Cmd>help</Cmd>`.
        </div>
      </div>
      <div className="illu-section">
        <PreImg>
          {`

                %@@@@@@@&@&#
             @@@@@@@@@@@@@@@@/
           @@@@@&@@&&&@&&@@@@@@(
         @@@@@#(//*///**/(#&&@@@@
         @@@#/***,,,,,,,,***#&@@@
         @&%(///**,,,,,***///(&@&
         &&(/(******,,******//#&
         .&(/((*//**,***///(//(%**
        /////**,,**/***,,,,,**//,/
         */(/**,,,//*/*/,,,**/((*
          ////**************//
            (//**///***/****/(
             (//****,,,***//(
             /(///***/////(/*
          ,****//////////****
       .,,///********,******//*(..
,,,,,,,,,.,.************,*****.....,,,,,
,,,,,,,,,,,.,...*******,,*......,.,,,.,.
         `}
        </PreImg>
      </div>
    </HeroContainer>
  );
};

export default Welcome;
