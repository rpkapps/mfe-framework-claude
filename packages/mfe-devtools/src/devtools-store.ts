/**
 * The panel's own state, and the override edits that have not been applied yet.
 *
 * Module state rather than context, for the reason the shell's `ui-store` gives:
 * there is one shell per document, anything may open the panel, and a store that
 * is not a component survives React Refresh replacing the panel you are looking
 * at.
 *
 * The draft lives here rather than in the shell's boot facts on purpose. Those
 * are frozen — nothing there changes after boot, and that is correct, because
 * they describe what the runtime actually loaded. An edit made in the panel is a
 * different fact: what *will* apply after a reload. Keeping the two apart
 * is what lets the panel show the difference instead of lying about one of them.
 */

import { SnapshotSource, shallowEqual } from '@company/mfe-core'
import { writeDevOverrides, type OverrideWritableStorage } from '@company/mfe-host'

import {
  DEFAULT_SETTINGS,
  readDevtoolsSettings,
  writeDevtoolsSettings,
  type DevtoolsSettings,
  type DevtoolsSide,
  type DevtoolsTab,
} from './devtools-settings.ts'

export interface DevtoolsState extends DevtoolsSettings {
  /**
   * Pending override edits: definition id → manifest URL, or `null` for one
   * staged to be removed. Empty means the panel agrees with what booted.
   */
  readonly draft: ReadonlyMap<string, string | null>
}

/** Smallest and largest a docked panel may be dragged to, in px. */
export const MIN_SIZE = 180
export const MAX_SIZE = 1200

function clamp(size: number): number {
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size)))
}

const EMPTY_DRAFT: ReadonlyMap<string, string | null> = new Map()

/**
 * Settings compare shallowly and the draft by reference, which is enough: every
 * write below replaces the map rather than mutating it, so an unchanged draft
 * keeps its identity and `useSyncExternalStore` consumers do not re-render.
 */
const source = new SnapshotSource<DevtoolsState>(
  { ...DEFAULT_SETTINGS, draft: EMPTY_DRAFT },
  { areEqual: shallowEqual },
)

/** Persists everything but the draft, which is deliberately not sticky. */
function publish(next: DevtoolsState): void {
  source.set(next)
  const { draft: _draft, ...settings } = next
  writeDevtoolsSettings(settings)
}

let initialised = false

/**
 * Reads storage and the query parameter once. Called from the mount rather than
 * at module scope so importing this package never touches the browser, which is
 * what keeps it safe to import from a server render or a test.
 */
export function initDevtools(): DevtoolsState {
  if (!initialised) {
    initialised = true
    source.set({ ...readDevtoolsSettings(), draft: EMPTY_DRAFT })
  }
  return source.getSnapshot()
}

export const devtools = {
  subscribe: source.subscribe,
  getSnapshot: source.getSnapshot,

  /** Turns the panel on and shows `tab`. The one entry point a host needs. */
  open(tab?: DevtoolsTab): void {
    const current = initDevtools()
    publish({ ...current, on: true, open: true, ...(tab === undefined ? {} : { tab }) })
  },

  close(): void {
    const current = source.getSnapshot()
    if (!current.open) return
    publish({ ...current, open: false })
  },

  toggle(): void {
    const current = initDevtools()
    if (current.on) publish({ ...current, open: !current.open })
    else publish({ ...current, on: true, open: true })
  },

  /** Turns the tool off entirely: no trigger, and the key is removed. */
  disable(): void {
    publish({ ...source.getSnapshot(), on: false, open: false, draft: EMPTY_DRAFT })
  },

  setSide(side: DevtoolsSide): void {
    publish({ ...source.getSnapshot(), side })
  },

  setSize(size: number): void {
    publish({ ...source.getSnapshot(), size: clamp(size) })
  },

  setTab(tab: DevtoolsTab): void {
    publish({ ...source.getSnapshot(), tab })
  },

  /** Stages an override. `null` stages a removal; `undefined` drops the edit. */
  stage(id: string, url: string | null | undefined): void {
    const current = source.getSnapshot()
    const draft = new Map(current.draft)
    if (url === undefined) draft.delete(id)
    else draft.set(id, url)
    source.set({ ...current, draft })
  },

  clearDraft(): void {
    const current = source.getSnapshot()
    if (current.draft.size === 0) return
    source.set({ ...current, draft: EMPTY_DRAFT })
  },

  /**
   * Writes the draft over the overrides that booted and reports whether the
   * browser allowed it. The caller reloads: remotes are registered once per
   * container name, so nothing about an override takes effect until boot.
   */
  apply(
    storage: OverrideWritableStorage | undefined,
    active: ReadonlyMap<string, string>,
  ): boolean {
    const merged = new Map(active)
    for (const [id, url] of source.getSnapshot().draft) {
      if (url === null) merged.delete(id)
      else merged.set(id, url)
    }
    return writeDevOverrides(storage, merged)
  },
}

/** The overrides that would apply after the next reload, for rendering the diff. */
export function resolvedOverrides(
  active: ReadonlyMap<string, string>,
  draft: ReadonlyMap<string, string | null>,
): ReadonlyMap<string, string> {
  const merged = new Map(active)
  for (const [id, url] of draft) {
    if (url === null) merged.delete(id)
    else merged.set(id, url)
  }
  return merged
}
