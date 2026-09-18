// @ts-check
/**
 * The shell is a host, not an MFE, so the workspace's `author` preset is only
 * *mostly* right for it. Two of its boundaries exist to stop an MFE behaving
 * like the whole page, and the shell legitimately is the whole page: it drives
 * the loader and registry from @company/mfe-host, and it injects the federation
 * runtime into the framework's loader. Both are re-allowed here and nowhere
 * else. Reading Web Storage stays confined to the override bootstrap.
 */
import mfe from '@company/eslint-plugin-mfe'

export default [
  { ignores: ['dist/**', 'node_modules/**'] },

  ...mfe.author({
    tsconfigRootDir: import.meta.dirname,
    files: ['src/**/*.{ts,tsx}'],
    storageAllowedScopes: ['src/boot.tsx'],
  }),

  {
    name: 'shell/host-surface',
    files: ['src/boot.tsx'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },
]
