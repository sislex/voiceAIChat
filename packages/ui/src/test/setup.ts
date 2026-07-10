import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  // cleanup нужен только в DOM-окружении.
  if (typeof document !== 'undefined') cleanup()
})
