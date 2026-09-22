/** Data rather than a fetch: a shell that cannot say what it is until a network call succeeds is useless in the incident where you needed to know. */

export type ChangeKind = 'added' | 'changed' | 'fixed'

export interface ReleaseNote {
  readonly kind: ChangeKind
  readonly text: string
}

export interface Release {
  readonly version: string
  /** ISO date. Rendered in the reader's locale, never printed raw. */
  readonly date: string
  readonly title: string
  readonly summary: string
  readonly notes: readonly ReleaseNote[]
}

export const releases: readonly Release[] = [
  {
    version: '1.3.0',
    date: '2026-09-19',
    title: 'Composition you can operate',
    summary:
      'The dashboard composes Widgets the shell was never built against, and every surface in the chrome now does something.',
    notes: [
      {
        kind: 'added',
        text: 'A Widget dashboard: drag a registered Widget onto the canvas, give it its inputs, and watch what it emits.',
      },
      {
        kind: 'added',
        text: 'Settings, keyboard help, release notes and a diagnostic report, all reachable from the header and the command palette.',
      },
      {
        kind: 'added',
        text: 'The command palette lists every application, every capability page an application published, and every command the mounted application registered.',
      },
      {
        kind: 'changed',
        text: 'Readouts across the shell and the lab show structured values instead of raw JSON.',
      },
      {
        kind: 'fixed',
        text: 'A mounting Widget reserves its tile, so the canvas no longer jumps as containers arrive.',
      },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-09-18',
    title: 'One command to run everything',
    summary:
      'The development loop stopped being the hard part: one command starts the shell and every container, and stops them again.',
    notes: [
      { kind: 'fixed', text: 'Ctrl-C stops the servers it started, and waits for the ports.' },
      {
        kind: 'fixed',
        text: 'A container is never relocated to another port — a busy port is reported once, with what holds it.',
      },
      { kind: 'fixed', text: 'A clean clone builds on Windows as well as everywhere else.' },
      {
        kind: 'changed',
        text: 'The build integration moved from Rspack to Rsbuild; a container declares a plugin, not a bundler configuration.',
      },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-09-17',
    title: 'Contracts at the boundary',
    summary:
      'Inputs are validated going in and event payloads going out, and a bad registry entry costs the page one surface instead of the page.',
    notes: [
      {
        kind: 'added',
        text: 'Per-entry registry rejection, with the reason and the repair in the registry view.',
      },
      {
        kind: 'added',
        text: 'Generated `#mfe/config`, `#mfe/fetch` and `#mfe/meta` for every container.',
      },
      {
        kind: 'fixed',
        text: 'A delegated child App was handed the whole path as its boundary instead of its own prefix.',
      },
    ],
  },
]
