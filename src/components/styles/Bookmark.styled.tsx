import styled, { keyframes } from "styled-components";

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

export const BookmarkAnnotation = styled.div`
  color: ${({ theme }) => theme.colors?.primary};
  font-style: italic;
  margin-top: 0.375rem;
  padding-left: 0.75rem;
  border-left: 2px solid ${({ theme }) => theme.colors?.secondary};
  line-height: 1.4rem;
  max-width: 600px;
`;

export const BookmarkProgressContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.375rem;
`;

export const BookmarkProgressBar = styled.div`
  width: 100px;
  height: 6px;
  background: ${({ theme }) => theme.colors?.text[300]}30;
  border-radius: 3px;
  overflow: hidden;
`;

export const BookmarkProgressFill = styled.div<{ $progress: number }>`
  height: 100%;
  width: ${({ $progress }) => $progress}%;
  background: ${({ theme, $progress }) =>
    $progress === 100 ? theme.colors?.primary : theme.colors?.secondary};
  transition: width 0.3s ease;
`;

export const BookmarkProgressText = styled.span`
  font-size: 0.75rem;
  color: ${({ theme }) => theme.colors?.text[200]};
`;

// Loading indicator styles
export const LoadingContainer = styled.div`
  margin: 0.5rem 0;
`;

export const ProgressText = styled.div`
  margin-bottom: 0.5rem;
  color: ${({ theme }) => theme.colors?.text[200]};
`;

export const ProgressBar = styled.div`
  width: 200px;
  height: 12px;
  background: ${({ theme }) => theme.colors?.text[300]}30;
  border: 1px solid ${({ theme }) => theme.colors?.text[300]};
  border-radius: 2px;
  overflow: hidden;
`;

const progressAnimation = keyframes`
  0% { opacity: 0.7; }
  50% { opacity: 1; }
  100% { opacity: 0.7; }
`;

export const ProgressFill = styled.div`
  height: 100%;
  background: ${({ theme }) => theme.colors?.secondary};
  transition: width 0.2s ease-out;
  animation: ${progressAnimation} 1s ease-in-out infinite;
`;
