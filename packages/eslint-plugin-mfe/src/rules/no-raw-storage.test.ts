import rule from './no-raw-storage.ts'
import { createRuleTester } from '../__tests__/rule-tester.ts'

const ADAPTER_SCOPES = [
  'packages/mfe-runtime/src/storage/**',
  'apps/shell/src/bootstrap/storage.ts',
]

createRuleTester().run('mfe/no-raw-storage', rule, {
  valid: [
    "import { useStoredState } from '@company/mfe-react'\nexport function usePrefs() {\n  return useStoredState('prefs', null)\n}",
    "export function read(localStorage: Storage) {\n  return localStorage.getItem('k')\n}",
    "const localStorage = createMemoryStorage()\nexport const value = localStorage.getItem('k')",
    "import { sessionStorage } from './fake-storage.ts'\nexport const value = sessionStorage.getItem('k')",
    'export const value = adapter.localStorage',
    'export const config = { localStorage: false }',
    // TypeScript type positions are not runtime access.
    'export type Backing = typeof localStorage',
    'declare const localStorage: Storage',
    {
      code: "export const raw = localStorage.getItem('k')",
      filename: 'packages/mfe-runtime/src/storage/web-storage-adapter.ts',
      options: [{ allowedScopes: ADAPTER_SCOPES }],
    },
    {
      code: "window.localStorage.setItem('mfe:override', JSON.stringify(overrides))",
      filename: 'apps/shell/src/bootstrap/storage.ts',
      options: [{ allowedScopes: ADAPTER_SCOPES }],
    },
    // The scope list does not cover this file, but the code here does not touch storage.
    {
      code: "export const value = storage.getItem('k')",
      filename: 'examples/reports/src/prefs.ts',
      options: [{ allowedScopes: ADAPTER_SCOPES }],
    },
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
          data: {
            access: 'localStorage',
            storedStateHook: 'useStoredState()',
            adapterModule: '@company/mfe-react',
          },
        },
      ],
    },
    {
      code: "sessionStorage.setItem('draft', body)",
      errors: [
        {
          messageId: 'rawStorage',
          data: {
            access: 'sessionStorage',
            storedStateHook: 'useStoredState()',
            adapterModule: '@company/mfe-react',
          },
        },
      ],
    },
    {
      code: "window.localStorage.setItem('prefs', body)",
      errors: [
        {
          messageId: 'rawStorage',
          data: {
            access: 'window.localStorage',
            storedStateHook: 'useStoredState()',
            adapterModule: '@company/mfe-react',
          },
        },
      ],
    },
    {
      code: 'export const backing = globalThis.sessionStorage',
      errors: [
        {
          messageId: 'rawStorage',
          data: {
            access: 'globalThis.sessionStorage',
            storedStateHook: 'useStoredState()',
            adapterModule: '@company/mfe-react',
          },
        },
      ],
    },
    {
      code: "export const value = (window as Window).localStorage.getItem('k')",
      errors: [
        {
          messageId: 'rawStorage',
          data: {
            access: '(window as Window).localStorage',
            storedStateHook: 'useStoredState()',
            adapterModule: '@company/mfe-react',
          },
        },
      ],
    },
    {
      code: 'const raw = localStorage\nexport const value = raw',
      errors: [
        {
          messageId: 'rawStorage',
          data: {
            access: 'localStorage',
            storedStateHook: 'useStoredState()',
            adapterModule: '@company/mfe-react',
          },
        },
      ],
    },
    {
      code: "export function Panel() {\n  const prefs = localStorage.getItem('prefs')\n  return prefs\n}",
      errors: [
        {
          messageId: 'rawStorage',
          data: {
            access: 'localStorage',
            storedStateHook: 'useStoredState()',
            adapterModule: '@company/mfe-react',
          },
        },
      ],
    },
    {
      code: "export const value = localStorage.getItem('k')",
      filename: 'examples/reports/src/prefs.ts',
      options: [{ allowedScopes: ADAPTER_SCOPES }],
      errors: [
        {
          messageId: 'rawStorage',
          data: {
            access: 'localStorage',
            storedStateHook: 'useStoredState()',
            adapterModule: '@company/mfe-react',
          },
        },
      ],
    },
  ],
})
