import { useContext, useEffect } from "react";
import { Wrapper, UsageDiv } from "../styles/Output.styled";
import { ThemeSpan, ThemesWrapper } from "../styles/Themes.styled";
import { termContext } from "../Terminal";
import { languageContext } from "@/pages/_app";
import { Language as LanguageType } from "@/utils/useLanguage";

const languages: LanguageType[] = ["en", "vn"];

const languageLabels: Record<LanguageType, string> = {
  en: "English",
  vn: "Tiếng Việt",
};

const Language: React.FC = () => {
  const { arg, rerender, index } = useContext(termContext);
  const { language, setLanguage } = useContext(languageContext);

  // Only set language for the most recent command (index 0) to avoid race conditions
  // where older commands in history also have rerender=true and would override the new setting
  useEffect(() => {
    if (index === 0 && rerender && arg[0] === "set" && languages.includes(arg[1] as LanguageType)) {
      setLanguage(arg[1] as LanguageType);
    }
  }, [index, arg, rerender, setLanguage]);

  const isValidArg = arg[0] === "set" && languages.includes(arg[1] as LanguageType) && arg.length === 2;

  if (arg.length > 0 && !isValidArg) {
    return (
      <UsageDiv>
        Usage: language set &lt;en|vn&gt; <br />
        eg: language set vn
      </UsageDiv>
    );
  }

  return (
    <Wrapper data-testid="language">
      <ThemesWrapper>
        {languages.map(lang => (
          <ThemeSpan key={lang} style={{ fontWeight: lang === language ? 'bold' : 'normal' }}>
            {lang} ({languageLabels[lang]}){lang === language ? ' *' : ''}
          </ThemeSpan>
        ))}
      </ThemesWrapper>
      <UsageDiv marginY>
        Usage: language set &lt;en|vn&gt; <br />
        eg: language set vn
      </UsageDiv>
    </Wrapper>
  );
};

export default Language;
