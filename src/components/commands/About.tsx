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
  WeatherSection,
  WeatherInfo,
} from "../styles/Welcome.styled";
import { useHomeContext } from "@/contexts";
import { termContext } from "../Terminal";
import { FileNode } from "@/types/files";
import { fetchWeather, getWeatherType, WeatherData } from "@/utils/weatherService";
import { getWeatherAsciiArt, loadingArt } from "@/utils/weatherAsciiArt";
import { GitHubIcon, LinkedInIcon, TwitterIcon, EmailIcon } from "@/components/icons/SocialIcons";

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

const projects = [
  {
    title: "Nguyen talk - podcast landing page",
    desc: "A landing page for a podcast series featuring career discussions and interviews.",
    url: "https://nguyentalk.com/",
  },
  {
    title: "Cokie typo fashion ecommerce",
    desc: "An ecommerce web application where users can browse various products and make purchases.",
    url: "https://cokie.store/",
  },
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

const About: React.FC = () => {
  const { allFileNode, bookmarks } = useHomeContext();
  const { executeCommand } = useContext(termContext);
  const blogPosts = getBlogPosts(allFileNode);
  const recentBookmarks = bookmarks.slice(0, 5); // Show last 5 bookmarks

  // Use fixed initial pun to prevent hydration mismatch, then randomize on client
  const [pun, setPun] = useState(puns[0]);
  const [weather, setWeather] = useState<WeatherData | null>(null);

  useEffect(() => {
    setPun(puns[Math.floor(Math.random() * puns.length)]);

    // Fetch weather for Bien Hoa, Vietnam
    fetchWeather().then(setWeather);
  }, []);

  const handleBlogClick = (filePath: string) => {
    if (executeCommand) {
      executeCommand(`cat ${filePath}`);
    }
  };

  const handleBookmarkClick = (bookmarkKey: string) => {
    if (executeCommand) {
      executeCommand(`cat bookmarks/${bookmarkKey}.md`);
    }
  };

  return (
    <HeroContainer data-testid="about">
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
            <div>+ Recent blog posts (<Cmd>ls -l blog</Cmd>):</div>
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
            <Seperator></Seperator>
          </>
        )}
        {recentBookmarks.length > 0 && (
          <>
            <div>+ Recent bookmarks (<Cmd>ls bookmarks</Cmd>):</div>
            <BlogList>
              {recentBookmarks.map((bookmark) => {
                return (
                  <div key={bookmark.key}>
                    <BlogLink onClick={() => handleBookmarkClick(bookmark.key)}>
                      {bookmark.title.length > 60 ? bookmark.title.slice(0, 60) + '...' : bookmark.title}
                    </BlogLink>
                  </div>
                );
              })}
            </BlogList>
            <Seperator>----</Seperator>
          </>
        )}
        <div>
          <div>Projects:</div>
          {projects.map(({ title, desc, url }) => (
            <div key={title}>
              - <Link href={url} target="_blank" rel="noopener noreferrer">{title}</Link>: {desc}
            </div>
          ))}
        <div>
          Reach me at:{" "}
          <Link href="https://github.com/ndp190" target="_blank" rel="noopener noreferrer"><GitHubIcon />GitHub</Link>{" | "}
          <Link href="https://www.linkedin.com/in/ndp190" target="_blank" rel="noopener noreferrer"><LinkedInIcon />LinkedIn</Link>{" | "}
          <Link href="https://twitter.com/ndp190" target="_blank" rel="noopener noreferrer"><TwitterIcon />Twitter</Link>{" | "}
          <Link href="mailto:ndp190@gmail.com"><EmailIcon />Email</Link>
        </div>
        </div>
        <Seperator>----</Seperator>
        <div>
          For a list of available commands, type `<Cmd>help</Cmd>`.
        </div>
      </div>
      <WeatherSection className="illu-section" data-testid="weather-section">
        <PreImg>
          {weather
            ? getWeatherAsciiArt(getWeatherType(weather.weatherCode), weather.isDay)
            : loadingArt}
        </PreImg>
        {weather && (
          <WeatherInfo data-testid="weather-info">
            <div>{weather.description} where I live</div>
            <div>{weather.temperature}°C</div>
          </WeatherInfo>
        )}
      </WeatherSection>
    </HeroContainer>
  );
};

export default About;
