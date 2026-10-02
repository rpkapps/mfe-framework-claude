/** Collected on demand, because a snapshot held from boot would describe a page that no longer exists. */

import type { MfeRuntime } from '@company/mfe-react'
import type { RuntimeDefinitionSnapshot, RuntimeSnapshot } from '@company/mfe-react/host'

import { notices, workspace } from './workspace.ts'

export interface Diagnostics {
  readonly workspace: string
  readonly url: string
  readonly mounted: string
  readonly runtimeSnapshot: RuntimeSnapshot
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
  const runtimeSnapshot = runtime.getSnapshot()
  const { entries, rejected } = runtimeSnapshot.registry
  const user = runtime.shellState.getUser()

  return {
    workspace: workspace.name,
    url: window.location.href,
    mounted:
      runtimeSnapshot.mounts.length === 0
        ? 'none'
        : runtimeSnapshot.mounts
            .map(mount => `${mount.definitionId} (${mount.kind}, ${mount.status})`)
            .join(', '),
    runtimeSnapshot,
    theme: runtime.shellState.getTheme(),
    user: user?.id ?? 'not signed in',
    groups: runtime.shellState.getGroups(),
    registryLoaded: entries.length,
    registryRejected: rejected.map(entry => `${entry.id}: ${entry.reason}`),
    builds: entries.map(describeBuild),
    registryError: notices.registryError === null ? null : notices.registryError.message,
    overrides: [...notices.overrides].map(([id, url]) => `${id} → ${url}`),
    viewport: `${String(window.innerWidth)}×${String(window.innerHeight)}`,
    userAgent: navigator.userAgent,
    at: new Date(runtimeSnapshot.capturedAt).toISOString(),
  }
}

/** One entry's build, as `<id>: <hash> · <time>`. */
function describeBuild(entry: RuntimeDefinitionSnapshot): string {
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
    '',
    '## Runtime snapshot',
    '',
    '```json',
    JSON.stringify(diagnostics.runtimeSnapshot, null, 2),
    '```',
  ]

  return lines.join('\n')
}

/** A labelled list, indented under its own line, or a word when it is empty. */
function list(label: string, lines: readonly string[], empty: string): string {
  const body = lines.length === 0 ? empty : `\n${lines.map(line => `  - ${line}`).join('\n')}`
  return `- ${label}: ${body}`
}
