import "styled-components";

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

declare module "styled-components" {
  export interface DefaultTheme {
    id: string;
    name: string;
    colors: Color;
  }
}
