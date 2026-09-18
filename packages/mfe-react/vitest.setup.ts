import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// §15.2: automatic cleanup after every test so no mount, root, subscription or
// registration leaks into the next one.
afterEach(() => {
  cleanup()
})
