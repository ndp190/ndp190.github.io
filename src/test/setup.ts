import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock ESM modules
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => children,
}))

vi.mock('remark-gfm', () => ({
  default: () => ({}),
}))

vi.mock('rehype-raw', () => ({
  default: () => ({}),
}))
