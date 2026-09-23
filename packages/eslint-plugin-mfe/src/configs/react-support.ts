/**
 * React Hooks and React Compiler diagnostics, shared by the `framework` preset (which lints the
 * framework's own React packages) and the `react` author preset. `eslint-plugin-react-hooks` is an
 * optional peer dependency, resolved here through `createRequire` so importing either preset's
 * module never demands it — only calling the preset does.
 */

import type { Linter } from 'eslint'
import { asConfigs, pluginsOf, withFiles } from './shared.ts'
import { loadPeer, requirePeers } from './peer-require.ts'

const REACT_HOOKS_INSTALL = 'pnpm add -D eslint-plugin-react-hooks'

interface ReactHooksModule {
  readonly configs: { readonly flat: { readonly 'recommended-latest': Linter.Config } }
}

let cachedReactHooks: ReactHooksModule | null = null

function reactHooks(): ReactHooksModule {
  if (cachedReactHooks !== null) return cachedReactHooks
  requirePeers(['eslint-plugin-react-hooks'], REACT_HOOKS_INSTALL)
  cachedReactHooks = loadPeer<ReactHooksModule>('eslint-plugin-react-hooks')
  return cachedReactHooks
}

/**
 * Each diagnostic reports code the React Compiler would bail out on, and an MFE that bails out
 * silently loses the memoisation the host sized its budget around.
 */
export function reactCorrectness(files: readonly (string | string[])[]): Linter.Config[] {
  const recommended = asConfigs([reactHooks().configs.flat['recommended-latest']])
  return [
    ...withFiles(recommended, files, 'mfe/react-hooks-recommended'),
    {
      name: 'mfe/react-compiler',
      files: files.map(pattern => (Array.isArray(pattern) ? [...pattern] : pattern)),
      plugins: pluginsOf(recommended),
      rules: {
        'react-hooks/capitalized-calls': 'error',
        'react-hooks/exhaustive-effect-dependencies': 'warn',
        'react-hooks/memo-dependencies': 'error',
        'react-hooks/memoized-effect-dependencies': 'warn',
        'react-hooks/no-deriving-state-in-effects': 'error',
        'react-hooks/void-use-memo': 'error',
        'react-hooks/rule-suppression': 'warn',
        // Raised from the warning `recommended-latest` sets.
        'react-hooks/exhaustive-deps': 'error',
        'react-hooks/incompatible-library': 'error',
      },
    },
  ]
}
