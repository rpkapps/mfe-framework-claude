import rule from './no-raw-storage.ts'
import { createRuleTester } from '../__tests__/rule-tester.ts'

const ADAPTER_SCOPES = ['packages/mfe-host/src/storage/**', 'apps/shell/src/bootstrap/storage.ts']

createRuleTester().run('mfe/no-raw-storage', rule, {
  valid: [
    // The boundary itself.
    "import { useMfeStorage } from '@company/mfe-react'\nexport function usePrefs() {\n  const storage = useMfeStorage()\n  return storage.getItem('prefs')\n}",
    "import { useStoredState } from '@company/mfe-react'\nexport function usePrefs() {\n  return useStoredState('prefs', null)\n}",
    // Shadowing: a parameter spelled like the global.
    "export function read(localStorage: Storage) {\n  return localStorage.getItem('k')\n}",
    // Shadowing: a local in-memory double.
    "const localStorage = createMemoryStorage()\nexport const value = localStorage.getItem('k')",
    // Shadowing: an import of the same name from a test helper.
    "import { sessionStorage } from './fake-storage.ts'\nexport const value = sessionStorage.getItem('k')",
    // A property named like the global on some other object.
    'export const value = adapter.localStorage',
    'export const config = { localStorage: false }',
    // TypeScript type positions are not runtime access.
    'export type Backing = typeof localStorage',
    'declare const localStorage: Storage',
    // The framework storage adapter opts out by explicit scope.
    {
      code: "export const raw = localStorage.getItem('k')",
      filename: 'packages/mfe-host/src/storage/web-storage-adapter.ts',
      options: [{ allowedScopes: ADAPTER_SCOPES }],
    },
    // A documented shell override bootstrap opts out by explicit scope.
    {
      code: "window.localStorage.setItem('mfe:override', JSON.stringify(overrides))",
      filename: 'apps/shell/src/bootstrap/storage.ts',
      options: [{ allowedScopes: ADAPTER_SCOPES }],
    },
    // A scope list that does not cover this file leaves the rule armed, but the
    // code here does not touch storage.
    {
      code: "export const value = storage.getItem('k')",
      filename: 'examples/reports/src/prefs.ts',
      options: [{ allowedScopes: ADAPTER_SCOPES }],
    },
    // `objects` can be narrowed.
    {
      code: "export const value = sessionStorage.getItem('k')",
      options: [{ objects: ['localStorage'] }],
    },
  ],

  invalid: [
    {
      code: "export const value = localStorage.getItem('prefs')",
      errors: [
        {
          messageId: 'rawStorage',
          data: { access: 'localStorage' },
          suggestions: [
            {
              messageId: 'useBoundary',
              data: { access: 'localStorage', accessor: 'storage' },
              output: "export const value = storage.getItem('prefs')",
            },
          ],
        },
      ],
    },
    {
      code: "sessionStorage.setItem('draft', body)",
      errors: [
        {
          messageId: 'rawStorage',
          data: { access: 'sessionStorage' },
          suggestions: [
            {
              messageId: 'useBoundary',
              data: { access: 'sessionStorage', accessor: 'storage' },
              output: "storage.setItem('draft', body)",
            },
          ],
        },
      ],
    },
    {
      code: "window.localStorage.setItem('prefs', body)",
      errors: [
        {
          messageId: 'rawStorage',
          data: { access: 'window.localStorage' },
          suggestions: [
            {
              messageId: 'useBoundary',
              data: { access: 'window.localStorage', accessor: 'storage' },
              output: "storage.setItem('prefs', body)",
            },
          ],
        },
      ],
    },
    {
      code: 'export const backing = globalThis.sessionStorage',
      errors: [
        {
          messageId: 'rawStorage',
          data: { access: 'globalThis.sessionStorage' },
          suggestions: [
            {
              messageId: 'useBoundary',
              data: { access: 'globalThis.sessionStorage', accessor: 'storage' },
              output: 'export const backing = storage',
            },
          ],
        },
      ],
    },
    {
      // TypeScript spelling: an assertion around the global is still the global.
      code: "export const value = (window as Window).localStorage.getItem('k')",
      errors: [
        {
          messageId: 'rawStorage',
          data: { access: '(window as Window).localStorage' },
          suggestions: [
            {
              messageId: 'useBoundary',
              data: { access: '(window as Window).localStorage', accessor: 'storage' },
              output: "export const value = storage.getItem('k')",
            },
          ],
        },
      ],
    },
    {
      // Aliasing the global does not launder it.
      code: 'const raw = localStorage\nexport const value = raw',
      errors: [
        {
          messageId: 'rawStorage',
          data: { access: 'localStorage' },
          suggestions: [
            {
              messageId: 'useBoundary',
              data: { access: 'localStorage', accessor: 'storage' },
              output: 'const raw = storage\nexport const value = raw',
            },
          ],
        },
      ],
    },
    {
      // Inside a component, where the hook should have been used.
      code: "export function Panel() {\n  const prefs = localStorage.getItem('prefs')\n  return prefs\n}",
      errors: [
        {
          messageId: 'rawStorage',
          data: { access: 'localStorage' },
          suggestions: [
            {
              messageId: 'useBoundary',
              data: { access: 'localStorage', accessor: 'storage' },
              output:
                "export function Panel() {\n  const prefs = storage.getItem('prefs')\n  return prefs\n}",
            },
          ],
        },
      ],
    },
    {
      // A file outside the configured adapter scopes is still guarded.
      code: "export const value = localStorage.getItem('k')",
      filename: 'examples/reports/src/prefs.ts',
      options: [{ allowedScopes: ADAPTER_SCOPES }],
      errors: [
        {
          messageId: 'rawStorage',
          data: { access: 'localStorage' },
          suggestions: [
            {
              messageId: 'useBoundary',
              data: { access: 'localStorage', accessor: 'storage' },
              output: "export const value = storage.getItem('k')",
            },
          ],
        },
      ],
    },
    {
      // The suggestion follows the project's own accessor name.
      code: "export const value = localStorage.getItem('k')",
      options: [{ storageAccessor: 'mfeStorage' }],
      errors: [
        {
          messageId: 'rawStorage',
          data: { access: 'localStorage' },
          suggestions: [
            {
              messageId: 'useBoundary',
              data: { access: 'localStorage', accessor: 'mfeStorage' },
              output: "export const value = mfeStorage.getItem('k')",
            },
          ],
        },
      ],
    },
  ],
})
