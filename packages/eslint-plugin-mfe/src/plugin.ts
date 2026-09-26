/**
 * The one plugin object ESLint registers under `mfe`. Flat config refuses two different objects
 * for one plugin name ("Cannot redefine plugin"), so every preset registers this object and the
 * package's default export is this object too: a config may name `{ plugins: { mfe } }` beside a
 * preset. The entry adds the presets to it; this module imports nothing that imports it back.
 */

import type { ESLint } from 'eslint'
import { rules } from './rules/index.ts'

export const meta = { name: '@company/eslint-plugin-mfe', version: '0.1.0' } as const

export const plugin: ESLint.Plugin & {
  readonly meta: typeof meta
  readonly rules: typeof rules
} = { meta, rules }
