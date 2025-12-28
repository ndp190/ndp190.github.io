import styled from "styled-components";

export const BookmarkContainer = styled.div`
  margin-top: 0.5rem;
  margin-bottom: 0.875rem;
`;

export const BookmarkIntro = styled.div`
  margin-top: 0.5rem;
  margin-bottom: 1rem;
  line-height: 1.5rem;
`;

export const BookmarkTitle = styled.div`
  font-weight: 700;
  margin-bottom: 0.25rem;
`;

export const BookmarkDesc = styled.div`
  color: ${({ theme }) => theme.colors?.text[200]};
  text-align: justify;
  line-height: 1.5rem;
  max-width: 600px;
`;

export const BookmarkUrl = styled.a`
  color: ${({ theme }) => theme.colors?.secondary};
  font-size: 0.875rem;
  text-decoration: none;
  word-break: break-all;

  &:hover {
    text-decoration: underline;
  }
`;
