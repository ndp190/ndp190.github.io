import { useCallback, useEffect, useState } from "react";
import { getFromLS, setToLS } from "../utils/storage";

export type Language = "en" | "vn";

export const useLanguage = () => {
  const [language, setLanguage] = useState<Language>("en");
  const [languageLoaded, setLanguageLoaded] = useState(false);

  const setLang = useCallback((lang: Language) => {
    setToLS("tsn-language", lang);
    setLanguage(lang);
  }, []);

  useEffect(() => {
    const localLang = getFromLS("tsn-language") as Language | undefined;
    if (localLang && (localLang === "en" || localLang === "vn")) {
      setLanguage(localLang);
    }
    setLanguageLoaded(true);
  }, []);

  return { language, languageLoaded, setLang };
};
