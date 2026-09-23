/**
 * TanStack Query and Router's own lint plugins, optional peers of the `react` author preset only
 * (the `framework` preset never turns these on — see `react-support.ts` for the React Hooks peer
 * every framework and author React file needs instead).
 */

import { loadPeer, requirePeers } from './peer-require.ts'

const TANSTACK_PACKAGES: readonly string[] = [
  '@tanstack/eslint-plugin-query',
  '@tanstack/eslint-plugin-router',
]

const TANSTACK_INSTALL = `pnpm add -D ${TANSTACK_PACKAGES.join(' ')}`

interface TanstackPluginModule {
  readonly configs: Record<string, unknown>
}

export interface TanstackPeers {
  readonly queryPlugin: TanstackPluginModule
  readonly routerPlugin: TanstackPluginModule
}

let cached: TanstackPeers | null = null

export function loadTanstackPeers(): TanstackPeers {
  if (cached !== null) return cached
  requirePeers(TANSTACK_PACKAGES, TANSTACK_INSTALL)
  cached = {
    queryPlugin: loadPeer<TanstackPluginModule>('@tanstack/eslint-plugin-query'),
    routerPlugin: loadPeer<TanstackPluginModule>('@tanstack/eslint-plugin-router'),
  }
  return cached
}
