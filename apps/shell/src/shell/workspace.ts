/**
 * What the shell itself knows.
 *
 * The workspace, the signed-in user and the starting theme are shell facts, not
 * registry facts: an MFE learns them through `useUser()`, `useGroups()` and
 * `useTheme()`, and never the other way round. In a real deployment these come
 * from the identity provider at boot; here they are a fixture so the header has
 * something to render.
 */

import type { AppFinderTone } from '@tecton/react/tecton/app-finder'
import type { ShellState } from '@company/mfe-react'

export interface Workspace {
  /** Short code shown in the brand tile. */
  readonly code: string
  readonly name: string
  readonly tone: AppFinderTone
}

export const workspace: Workspace = {
  code: 'DSG',
  name: 'Discovery',
  tone: 'blue',
}

export const initialShellState: ShellState = {
  user: {
    id: 'u-2841',
    name: 'Robin Kolesnik',
    email: 'robin.kolesnik@example.com',
    tenantId: 'northern-basin',
  },
  groups: ['geoscience', 'well-planning.read'],
  theme: 'dark',
}

/** Initials for the avatar, from whatever the identity provider gave us. */
export function initialsOf(name: string | undefined): string {
  if (!name) return '?'
  const parts = name.split(/\s+/).filter(Boolean)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : ''
  return (first + last).toUpperCase() || '?'
}

/**
 * Tile colour for an App. The registry carries no colour, so it is derived from
 * the id: stable across reloads, and distinct enough to tell a list of apps
 * apart at a glance.
 */
const TONES: readonly AppFinderTone[] = [
  'blue',
  'green',
  'violet',
  'saffron',
  'azure',
  'orchid',
  'lime',
  'mauve',
]

export function toneFor(id: string): AppFinderTone {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  }
  return TONES[hash % TONES.length] ?? 'neutral'
}

/** Short code for an App's tile: the registry `icon`, else the id's initials. */
export function codeFor(id: string, icon: string | undefined): string {
  if (icon && icon.length <= 4) return icon.toUpperCase()
  const words = id.split('-').filter(Boolean)
  if (words.length === 1) return (words[0] ?? id).slice(0, 3).toUpperCase()
  return words
    .slice(0, 3)
    .map(word => word[0] ?? '')
    .join('')
    .toUpperCase()
}
