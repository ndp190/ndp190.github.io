import {
  Cmd,
  HeroContainer,
  Link,
  PreImg,
  PreName,
  PreNameMobile,
  PreWrapper,
  Seperator,
} from "../styles/Welcome.styled";

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

const Welcome: React.FC = () => {
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
