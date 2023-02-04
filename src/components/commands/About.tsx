import {
  AboutWrapper,
  HighlightAlt,
  HighlightSpan,
} from "../styles/About.styled";

const About: React.FC = () => {
  // TODO add social icons
  return (
    <AboutWrapper data-testid="about">
      <p>
        Hello, I'm <HighlightSpan>Nikk</HighlightSpan>, but you can call me <HighlightSpan>Phuc</HighlightSpan> if you're feeling fancy!
      </p>
      <p>
        I'm <HighlightAlt>a developer</HighlightAlt> with a passion for solving problems and discovering new things. I've been working with <a href="https://www.go1.com" target="_blank">Go1</a> for some time now and am proud of the skills I've acquired. You can reach out to me at:
      </p>
      <ul>
        <li>Github <a href="https://github.com/ndp190" target="_blank">https://github.com/ndp190</a></li>
        <li>LinkedIn <a href="https://www.linkedin.com/in/ndp190" target="_blank">https://www.linkedin.com/in/ndp190</a></li>
        <li>Twitter <a href="https://twitter.com/ndp190" target="_blank">https://twitter.com/ndp190</a></li>
        <li>Email <a href="mailto:ndp190@gmail.com">ndp190@gmail.com</a></li>
      </ul>
    </AboutWrapper>
  );
};

export default About;
