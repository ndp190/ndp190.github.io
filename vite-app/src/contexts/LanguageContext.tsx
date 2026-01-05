import { createContext, useContext } from "react";
import { Language } from "@/hooks/useLanguage";

export interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
}

export const LanguageContext = createContext<LanguageContextValue>({
  language: "en",
  setLanguage: () => {},
});

export const useLanguageContext = () => {
  return useContext(LanguageContext);
};
