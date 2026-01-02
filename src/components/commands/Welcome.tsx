import { useContext, useState, useEffect } from "react";
import {
  BlogLink,
  BlogList,
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
import { BookmarkManifestItem } from "@/types/bookmark";

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

function formatFileSize(size: number): string {
  const units = ["B", "K", "M", "G", "T"];
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index++;
  }
  if (index === 0) {
    return `${size.toString().padStart(4, ' ')}`;
  }
  return `${size.toFixed(1).padStart(4, ' ')}${units[index]}`;
}

function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate().toString().padStart(2, '0');
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${month} ${day} ${hours}:${minutes}`;
}

const Welcome: React.FC = () => {
  const { allFileNode, bookmarks } = useContext(homeContext);
  const { executeCommand } = useContext(termContext);
  const blogPosts = getBlogPosts(allFileNode);
  const recentBookmarks = bookmarks.slice(0, 5); // Show last 5 bookmarks

  // Use fixed initial pun to prevent hydration mismatch, then randomize on client
  const [pun, setPun] = useState(puns[0]);
  useEffect(() => {
    setPun(puns[Math.floor(Math.random() * puns.length)]);
  }, []);

  const handleBlogClick = (filePath: string) => {
    if (executeCommand) {
      executeCommand(`cat ${filePath}`);
    }
  };

  const handleBookmarkClick = (bookmarkId: number) => {
    if (executeCommand) {
      executeCommand(`bookmark cat ${bookmarkId}`);
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
            <div>Recent blog posts (<Cmd>ls -l blog</Cmd>):</div>
            <BlogList>
              {blogPosts.map((post) => {
                const filePath = post.path.replace(/^terminal\//, '');
                const size = formatFileSize(post.size || 0);
                const date = formatDateTime(post.timestamp || Date.now());
                return (
                  <div key={post.name}>
                    <span className="file-info">{size}  {date}  </span>
                    <BlogLink onClick={() => handleBlogClick(filePath)}>
                      {post.name}
                    </BlogLink>
                  </div>
                );
              })}
            </BlogList>
            <Seperator>----</Seperator>
          </>
        )}
        {recentBookmarks.length > 0 && (
          <>
            <div>Recent bookmarks (<Cmd>bookmark</Cmd>):</div>
            <BlogList>
              {recentBookmarks.map((bookmark) => {
                const idStr = String(bookmark.id).padStart(3, ' ');
                return (
                  <div key={bookmark.id}>
                    <span className="file-info">{idStr}  </span>
                    <BlogLink onClick={() => handleBookmarkClick(bookmark.id)}>
                      {bookmark.title.length > 50 ? bookmark.title.slice(0, 50) + '...' : bookmark.title}
                    </BlogLink>
                  </div>
                );
              })}
            </BlogList>
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
