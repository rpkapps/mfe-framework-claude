/**
 * The facts a bug report has to carry.
 *
 * A report that says "the page was broken" costs an engineer a day of asking
 * which build, which registry and which container. Everything below is already
 * known to the shell at the moment the report is written, so the reporter is
 * asked for none of it.
 *
 * Collected on demand rather than kept in state: it is read once, when someone
 * opens the report, and a snapshot held from boot would describe a page that no
 * longer exists.
 */

import type { MfeRuntime } from '@company/mfe-react'

import { notices, workspace } from './workspace.ts'

export interface Diagnostics {
  readonly workspace: string
  readonly url: string
  readonly mounted: string
  readonly theme: string
  readonly user: string
  readonly groups: readonly string[]
  readonly registryLoaded: number
  readonly registryRejected: readonly string[]
  readonly overrides: readonly string[]
  readonly viewport: string
  readonly userAgent: string
  readonly at: string
}

export function collectDiagnostics(runtime: MfeRuntime): Diagnostics {
  const { entries, quarantined } = runtime.registry
  const user = runtime.shellState.getUser()
  const path = window.location.pathname
  const mountedId = path.split('/').filter(Boolean)[0]

  return {
    workspace: workspace.name,
    url: window.location.href,
    mounted: mountedId === undefined ? 'the widget dashboard' : mountedId,
    theme: runtime.shellState.getTheme(),
    user: user?.id ?? 'not signed in',
    groups: runtime.shellState.getGroups(),
    registryLoaded: entries.size,
    registryRejected: quarantined.map(entry => `${entry.id}: ${entry.reason}`),
    overrides: [...notices.overrides].map(([id, url]) => `${id} → ${url}`),
    viewport: `${String(window.innerWidth)}×${String(window.innerHeight)}`,
    userAgent: navigator.userAgent,
    at: new Date().toISOString(),
  }
}

/**
 * The report as text, ready for an issue tracker. Markdown because every
 * tracker in use renders it and the ones that do not still show it readably.
 */
export function formatReport(summary: string, detail: string, diagnostics: Diagnostics): string {
  const lines = [
    `# ${summary === '' ? 'Bug report' : summary}`,
    '',
    detail === '' ? '_No description given._' : detail,
    '',
    '## Environment',
    '',
    `- Workspace: ${diagnostics.workspace}`,
    `- URL: ${diagnostics.url}`,
    `- Mounted: ${diagnostics.mounted}`,
    `- Theme: ${diagnostics.theme}`,
    `- User: ${diagnostics.user}`,
    `- Groups: ${diagnostics.groups.join(', ')}`,
    `- Viewport: ${diagnostics.viewport}`,
    `- Reported: ${diagnostics.at}`,
    `- User agent: ${diagnostics.userAgent}`,
    '',
    '## Registry',
    '',
    `- Loaded: ${String(diagnostics.registryLoaded)}`,
    `- Rejected: ${
      diagnostics.registryRejected.length === 0
        ? 'none'
        : `\n${diagnostics.registryRejected.map(line => `  - ${line}`).join('\n')}`
    }`,
    `- Developer overrides: ${
      diagnostics.overrides.length === 0
        ? 'none'
        : `\n${diagnostics.overrides.map(line => `  - ${line}`).join('\n')}`
    }`,
  ]

  return lines.join('\n')
}
