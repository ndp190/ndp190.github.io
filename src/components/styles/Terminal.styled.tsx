import styled from "styled-components";

export const Wrapper = styled.div`
  padding: 1.25rem;
  padding-top: 0.75rem;

  display: flex;
  flex-direction: column-reverse;
  max-height: calc(100vh - 2rem);
  max-width: 100vw;
  overflow-y: auto;
  overflow-x: hidden;
  word-break: break-word;
`;

export const CmdNotFound = styled.div`
  margin-top: 0.25rem;
  margin-bottom: 1rem;
`;

export const Empty = styled.div`
  margin-bottom: 0.25rem;
`;

export const MobileSpan = styled.span`
  line-height: 1.5rem;
  margin-right: 0.75rem;

  @media (min-width: 550px) {
    display: none;
  }
`;

export const MobileBr = styled.br`
  @media (min-width: 550px) {
    display: none;
  }
`;

export const Form = styled.form`
  @media (min-width: 550px) {
    display: flex;
  }
`;

export const Input = styled.input`
  flex-grow: 1;

  @media (max-width: 550px) {
    min-width: 85%;
  }
`;

export const HintsContainer = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.5rem;
  margin-bottom: 0.5rem;
  padding: 0.5rem;
  background-color: ${({ theme }) => theme.colors?.body};
  border: 1px solid ${({ theme }) => theme.colors?.text?.[300] || '#555'};
  border-radius: 4px;
`;

export const Hints = styled.span<{ $highlighted?: boolean }>`
  padding: 0.125rem 0.375rem;
  border-radius: 3px;
  background-color: ${({ $highlighted, theme }) =>
    $highlighted
      ? theme.colors?.primary || '#fff'
      : theme.colors?.text?.[300] + '33' || 'rgba(85, 85, 85, 0.2)'};
  color: ${({ $highlighted, theme }) =>
    $highlighted
      ? theme.colors?.body || '#000'
      : theme.colors?.text?.[100] || '#fff'};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
`;

export const KeyboardButton = styled.button`
  position: fixed;
  bottom: 1.5rem;
  right: 1.5rem;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors?.primary || '#fff'};
  color: ${({ theme }) => theme.colors?.body || '#000'};
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  transition: transform 0.2s ease, opacity 0.2s ease;

  &:active {
    transform: scale(0.95);
  }

  @media (min-width: 550px) {
    display: none;
  }

  svg {
    width: 1.75rem;
    height: 1.75rem;
  }
`;
