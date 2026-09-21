/** Collected on demand, because a snapshot held from boot would describe a page that no longer exists. */

import type { MfeRuntime, NeutralRegistryEntry } from '@company/mfe-react'

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
  /** An entry that named no build says so, since a missing line reads as a missing container (§29). */
  readonly builds: readonly string[]
  /** Why `registry.json` would not load: the only place that now surfaces. */
  readonly registryError: string | null
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
    builds: [...entries.values()].map(describeBuild),
    registryError: notices.registryError === null ? null : notices.registryError.message,
    overrides: [...notices.overrides].map(([id, url]) => `${id} → ${url}`),
    viewport: `${String(window.innerWidth)}×${String(window.innerHeight)}`,
    userAgent: navigator.userAgent,
    at: new Date().toISOString(),
  }
}

/** One entry's build, as `<id>: <hash> · <time>`. */
function describeBuild(entry: NeutralRegistryEntry): string {
  const build = entry.build
  if (build === undefined) return `${entry.id}: no build published`
  return `${entry.id}: ${build.hash ?? 'unknown hash'} · ${build.time ?? 'unknown time'}`
}

/** The report as text: Markdown, which every tracker in use renders. */
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
    `- registry.json: ${diagnostics.registryError ?? 'loaded'}`,
    `- Loaded: ${String(diagnostics.registryLoaded)}`,
    list('Rejected', diagnostics.registryRejected, 'none'),
    list('Developer overrides', diagnostics.overrides, 'none'),
    list('Builds', diagnostics.builds, 'nothing loaded'),
  ]

  return lines.join('\n')
}

/** A labelled list, indented under its own line, or a word when it is empty. */
function list(label: string, lines: readonly string[], empty: string): string {
  const body = lines.length === 0 ? empty : `\n${lines.map(line => `  - ${line}`).join('\n')}`
  return `- ${label}: ${body}`
}
