import styled from "styled-components";
import { DefaultTheme as StyledDefaultTheme } from "styled-components";

export const ThemesWrapper = styled.div`
  display: flex;
  flex-wrap: wrap;
`;

export const ThemeSpan = styled.span`
  margin-right: 0.875rem;
  margin-bottom: 0.25rem;
  white-space: nowrap;
`;

interface Color {
  body: string;
  scrollHandle: string;
  scrollHandleHover: string;
  primary: string;
  secondary: string;
  text: {
    100: string;
    200: string;
    300: string;
  };
}

export interface DefaultTheme extends StyledDefaultTheme {
  id: string;
  name: string;
  colors: Color;
}
