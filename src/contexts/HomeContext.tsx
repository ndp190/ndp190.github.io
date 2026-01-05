import { createContext, useContext } from "react";
import { FileNode } from "@/types/files";
import { BookmarkManifestItem } from "@/types/bookmark";
import { Language } from "@/hooks/useLanguage";

// Translation map: maps original file path to translated content
export type TranslationsMap = Record<string, string>;

// All translations by language
export type AllTranslations = Partial<Record<Language, TranslationsMap>>;

export interface HomeContextValue {
  allFileNode: FileNode;
  translations: AllTranslations;
  bookmarks: BookmarkManifestItem[];
}

export const HomeContext = createContext<HomeContextValue>({
  allFileNode: {
    name: '',
    path: '',
    isDirectory: false,
  },
  translations: {},
  bookmarks: [],
});

export const useHomeContext = () => {
  return useContext(HomeContext);
};
