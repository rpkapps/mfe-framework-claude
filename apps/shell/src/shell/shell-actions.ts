/**
 * The shell's own actions, registered in the host page's scope exactly as a mounted App
 * registers its own, so the palette, the help sheet and the key listener read one list (§26).
 * A shortcut here is the host page's, which the runtime reserves: a container cannot take it.
 *
 * What an action looks like in the palette lives beside the palette; this module is what it
 * does, so it can be registered and pressed without rendering anything.
 */

import {
  allow,
  deny,
  type ActionRegistration,
  type MfeRuntime,
  type StoredStateSetter,
} from '@company/mfe-react'
import { devtools } from '@company/mfe-devtools'
import { toast } from 'sonner'

import { EMPTY_LAYOUT, type DashboardLayout } from './dashboard/layout-store.ts'
import { collectDiagnostics, formatReport } from './diagnostics.ts'
import type { ShellTheme } from './preferences.ts'
import { shellUi } from './ui-store.ts'

/** What a shell action reads at the render it was built in. */
export interface ShellActionContext {
  readonly runtime: MfeRuntime
  readonly theme: ShellTheme
  readonly layout: DashboardLayout
  readonly setLayout: StoredStateSetter<DashboardLayout>
  readonly goToDashboard: () => void
}

/**
 * Built afresh every render and re-applied after every commit, so a label that follows the theme
 * and a closure that reads the layout are always current. The order is the help sheet's, and it
 * never changes, because the registrations are matched to their handles by position.
 */
export function shellActions(context: ShellActionContext): readonly ActionRegistration[] {
  const { runtime, theme, layout, setLayout } = context
  const otherTheme = theme === 'dark' ? 'light' : 'dark'

  return [
    {
      name: 'palette',
      label: 'Search or jump to…',
      shortcut: 'mod+k',
      // Listed nowhere: it opens the palette. The keys work whatever the placements say.
      placements: [],
      execute: () => {
        shellUi.toggle('palette')
      },
    },
    {
      name: 'help',
      label: 'Help and keyboard shortcuts',
      shortcut: '?',
      // Opening a panel changes nothing the user keeps, so the agent may do it without asking.
      effect: 'read',
      execute: () => {
        shellUi.toggle('help')
      },
    },
    {
      name: 'registry',
      label: 'Open the registry',
      shortcut: 'g r',
      effect: 'read',
      execute: () => {
        devtools.open('registry')
      },
    },
    {
      name: 'devtools',
      label: 'Open the developer tools',
      shortcut: 'g d',
      // Listed nowhere: the palette reaches the developer tools as a destination.
      placements: [],
      execute: () => {
        devtools.open('overrides')
      },
    },
    {
      name: 'settings',
      label: 'Open settings',
      shortcut: 'g s',
      effect: 'read',
      execute: () => {
        shellUi.toggle('settings')
      },
    },
    {
      name: 'dashboard',
      label: 'Go to the Widget dashboard',
      shortcut: 'g w',
      // Listed nowhere: the palette reaches the dashboard as a destination.
      placements: [],
      execute: context.goToDashboard,
    },
    {
      name: 'theme',
      label: `Switch to ${otherTheme} theme`,
      shortcut: 'mod+j',
      execute: () => {
        runtime.shellState.apply({ theme: otherTheme })
      },
    },
    {
      name: 'releases',
      label: 'What’s new',
      effect: 'read',
      execute: () => {
        shellUi.show('releases')
      },
    },
    {
      name: 'bug',
      label: 'Report a bug',
      effect: 'read',
      execute: () => {
        shellUi.show('bug')
      },
    },
    {
      name: 'copy-url',
      label: 'Copy a link to this page',
      // The clipboard is the user's, so only they are offered it.
      placements: ['palette'],
      execute: () => copyToClipboard(window.location.href, 'Link copied to the clipboard.'),
    },
    {
      name: 'copy-diagnostics',
      label: 'Copy diagnostics',
      placements: ['palette'],
      execute: () => {
        const detail = 'Copied from the command palette.'
        const report = formatReport('Shell diagnostics', detail, collectDiagnostics(runtime))
        return copyToClipboard(report, 'Diagnostics copied to the clipboard.')
      },
    },
    {
      name: 'clear-dashboard',
      label: 'Clear the dashboard canvas',
      description: 'Removes every Widget from the dashboard canvas. It cannot be undone.',
      effect: 'destructive',
      // Listed and denied rather than hidden: a control that disappears reads as a lost feature.
      canExecute: () =>
        layout.tiles.length === 0 ? deny('The dashboard canvas is already empty.') : allow(),
      execute: () => {
        setLayout(EMPTY_LAYOUT)
        toast.success('The dashboard canvas was cleared.')
      },
    },
  ]
}

async function copyToClipboard(value: string, success: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
    toast.success(success)
  } catch {
    toast.error('This browser would not give the page the clipboard.')
  }
}
