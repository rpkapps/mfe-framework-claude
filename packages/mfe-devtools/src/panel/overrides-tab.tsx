/**
 * Pointing a definition at a dev server, which is the reason this package
 * exists.
 *
 * Two things this view refuses to blur. An override only takes effect at boot —
 * one container is registered once, under one name, and its chunks are already
 * on the page — so an edit here is *pending* until a reload, and it is shown as
 * a diff against what actually booted rather than as a value that looks live.
 * And a URL is all an override carries: accepting configuration here is what
 * would turn a debugging aid into a second configuration surface.
 *
 * The layout went through two wrong answers before this one. A stack of cards
 * made eight definitions look equally interesting; replacing it with a table of
 * eight identical full-width text boxes was worse, because a wall of inputs
 * reads as a form to fill in rather than a list to scan, and the one row you
 * had actually changed disappeared into it.
 *
 * So a URL here is *information* until somebody decides to change it. Rows
 * render their URL as text, the actions appear on hover or focus, and an input
 * exists only where there is an edit or an override to see. What is left is a
 * list you can read down, with the interesting rows the only ones carrying any
 * weight.
 */

import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { Button } from '@tecton/react/components/button'
import { Input } from '@tecton/react/components/input'
import {
  AppWindowIcon,
  BoxIcon,
  PencilIcon,
  RotateCcwIcon,
  ServerIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react'

import { browserStorage } from '../browser-storage.ts'
import { devtools, resolvedOverrides } from '../devtools-store.ts'
import { conflictingContainers, manifestUrlFor, validateDraft } from './override-draft.ts'
import { useActiveOverrides, useContainerLookup, useRegistryEntries } from './use-devtools.ts'

/** What a row is: untouched, overridden at boot, or edited since. */
type RowState = 'default' | 'overridden' | 'pending'

/**
 * The left edge carries the state. A 2px rule the eye finds in a list of eight
 * is worth more than a word that has to be read in each one, and every row
 * declares the border so nothing shifts as a row changes state.
 */
const ROW_ACCENT: Readonly<Record<RowState, string>> = {
  default: 'border-l-transparent',
  overridden: 'border-l-warning bg-warning-surface/8',
  pending: 'border-l-info bg-info-surface/10',
}

/** The row's icon says the same thing as its edge, in the same colour. */
const ROW_ICON: Readonly<Record<RowState, string>> = {
  default: 'text-muted-foreground',
  overridden: 'text-warning',
  pending: 'text-info',
}

export function OverridesTab(): ReactNode {
  const { draft } = useSyncExternalStore(
    devtools.subscribe,
    devtools.getSnapshot,
    devtools.getSnapshot,
  )
  const entries = useRegistryEntries()
  const inForce = useActiveOverrides()
  const containerOf = useContainerLookup()

  const [origin, setOrigin] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const devServerUrl = manifestUrlFor(origin)

  const problems = validateDraft(draft)
  const conflicts = conflictingContainers(resolvedOverrides(inForce, draft), containerOf)
  const canApply = draft.size > 0 && problems.length === 0 && conflicts.length === 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <DevServerBar origin={origin} onOriginChange={setOrigin} resolved={devServerUrl} />

        {entries.length === 0 ? (
          <p className="rounded-lg border border-border-subtle px-3 py-8 text-center text-sm text-muted-foreground">
            The registry accepted no entries, so there is nothing to point anywhere. The Registry
            tab says why.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle">
            {entries.map(entry => {
              const staged = draft.get(entry.id)
              const applied = inForce.get(entry.id)
              const state: RowState =
                staged !== undefined ? 'pending' : applied === undefined ? 'default' : 'overridden'

              return (
                <OverrideRow
                  key={entry.id}
                  id={entry.id}
                  isApp={entry.definitionKind === 'app'}
                  published={entry.manifestUrl}
                  applied={applied}
                  staged={staged}
                  state={state}
                  devServerUrl={devServerUrl}
                  problem={problems.find(problem => problem.id === entry.id)?.message}
                  isEditing={editing === entry.id}
                  onEdit={() => {
                    setEditing(entry.id)
                  }}
                  onDone={() => {
                    setEditing(current => (current === entry.id ? null : current))
                  }}
                />
              )
            })}
          </ul>
        )}

        {conflicts.length === 0 ? null : (
          <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive-surface/25 p-3">
            {conflicts.map(conflict => (
              <p
                key={conflict.container}
                className="flex items-start gap-2 text-xs leading-relaxed"
              >
                <TriangleAlertIcon
                  aria-hidden
                  className="mt-0.5 size-3.5 shrink-0 text-destructive"
                />
                <span>
                  <span className="font-mono font-medium">{conflict.container}</span> is one
                  container, registered once — its definitions cannot load from two URLs. Point{' '}
                  {conflict.entries.map(([id]) => id).join(' and ')} at the same one.
                </span>
              </p>
            ))}
          </div>
        )}
      </div>

      <PendingFooter
        pending={draft.size}
        canApply={canApply}
        hasOverrides={inForce.size > 0}
        onApply={() => {
          if (devtools.apply(browserStorage(), inForce)) window.location.reload()
        }}
      />
    </div>
  )
}

/**
 * The shortcut: one origin, then one click on the row you care about.
 *
 * This began as a multi-select — an origin, a toggle per definition, then a
 * "point" button — and the toggles overflowed the panel at any dock width
 * narrow enough to be useful. Typing a port and pressing "use" on one row is
 * both smaller and fewer steps.
 */
function DevServerBar({
  origin,
  onOriginChange,
  resolved,
}: {
  readonly origin: string
  readonly onOriginChange: (next: string) => void
  readonly resolved: string | undefined
}): ReactNode {
  const isBlank = origin.trim() === ''
  const isBad = !isBlank && resolved === undefined

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border-subtle bg-surface-alt/50 px-3 py-2.5">
      <label
        htmlFor="mfe-devtools-origin"
        className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground"
      >
        <ServerIcon aria-hidden className="size-3.5" />
        Dev server
      </label>

      <Input
        id="mfe-devtools-origin"
        placeholder="3001"
        value={origin}
        onChange={event => {
          onOriginChange(event.target.value)
        }}
        className="h-8 w-40 shrink-0 font-mono text-xs"
      />

      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground @max-md:basis-full">
        {isBlank ? (
          'A port is enough. Then “use” it on any row.'
        ) : isBad ? (
          <span className="text-destructive">Not a URL — try a port, or host:port.</span>
        ) : (
          <span className="font-mono">{resolved}</span>
        )}
      </p>
    </div>
  )
}

/**
 * One definition, one line.
 *
 * `staged` is the pending edit — a string to set, `null` to clear, `undefined`
 * for no edit at all. Not just an empty string, because clearing an override
 * and never having touched one are different intentions, and the footer counts
 * them differently.
 */
function OverrideRow({
  id,
  isApp,
  published,
  applied,
  staged,
  state,
  devServerUrl,
  problem,
  isEditing,
  onEdit,
  onDone,
}: {
  readonly id: string
  readonly isApp: boolean
  readonly published: string
  readonly applied: string | undefined
  readonly staged: string | null | undefined
  readonly state: RowState
  readonly devServerUrl: string | undefined
  readonly problem: string | undefined
  readonly isEditing: boolean
  readonly onEdit: () => void
  readonly onDone: () => void
}): ReactNode {
  const value = staged === undefined ? (applied ?? '') : (staged ?? '')
  const showsInput = isEditing || state !== 'default'
  const Icon = isApp ? AppWindowIcon : BoxIcon

  return (
    <li className={`group border-l-2 px-3 py-1.5 ${ROW_ACCENT[state]}`}>
      <div className="grid gap-x-3 gap-y-1 @md:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] @md:items-center">
        <div className="flex min-w-0 items-center gap-2">
          <Icon aria-hidden className={`size-3.5 shrink-0 ${ROW_ICON[state]}`} />
          <span className="truncate font-mono text-xs font-medium">{id}</span>
        </div>

        <div className="flex min-w-0 items-center gap-1">
          {showsInput ? (
            <Input
              autoFocus={isEditing}
              aria-label={`Manifest URL for ${id}`}
              placeholder={published}
              value={value}
              onBlur={onDone}
              onChange={event => {
                devtools.stage(id, event.target.value)
              }}
              className="h-7 min-w-0 flex-1 font-mono text-xs"
            />
          ) : (
            /*
             * The URL as text, and as the edit affordance. A row nobody has
             * touched is something to read, so it is not a box; clicking it is
             * how it becomes one, and the pencil that appears on hover is what
             * says so without adding a control to every row.
             */
            <button
              type="button"
              onClick={onEdit}
              title={published}
              className="flex min-w-0 flex-1 cursor-text rounded px-1 py-1 text-left font-mono text-xs hover:bg-ghost-hover"
            >
              <UrlText url={published} />
            </button>
          )}

          <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
            {devServerUrl === undefined || value === devServerUrl ? null : (
              <Button
                variant="ghost"
                size="xs"
                aria-label={`Point ${id} at the dev server`}
                onPress={() => {
                  devtools.stage(id, devServerUrl)
                }}
              >
                Use
              </Button>
            )}

            {staged !== undefined ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Discard the pending edit for ${id}`}
                onPress={() => {
                  devtools.stage(id, undefined)
                  onDone()
                }}
              >
                <RotateCcwIcon />
              </Button>
            ) : applied !== undefined ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Clear the override for ${id}`}
                onPress={() => {
                  devtools.stage(id, null)
                }}
              >
                <Trash2Icon />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit the manifest URL for ${id}`}
                onPress={onEdit}
              >
                <PencilIcon />
              </Button>
            )}
          </div>
        </div>
      </div>

      {problem === undefined ? null : (
        <p className="mt-0.5 text-xs text-destructive @md:ml-[10.75rem]">{problem}</p>
      )}

      {/*
       * Muted, not blue: the edge and the icon already say "pending", and the
       * surface-foreground token is nearly the surface itself on this card.
       */}
      {staged === undefined ? null : (
        <p className="mt-0.5 truncate text-xs text-muted-foreground @md:ml-[10.75rem]">
          in force now:{' '}
          <span className="font-mono text-foreground/90">
            {applied ?? 'the published manifest'}
          </span>
        </p>
      )}
    </li>
  )
}

/**
 * The origin is the part you read; the rest is the same eight times over.
 * Dimming it is what lets the list be scanned by port rather than by prefix.
 */
function UrlText({ url }: { readonly url: string }): ReactNode {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return <>{url}</>
  }

  return (
    <>
      <span className="shrink-0 text-muted-foreground">{parsed.protocol}//</span>
      <span className="shrink-0 font-medium text-foreground">{parsed.host}</span>
      <span className="truncate text-muted-foreground">{parsed.pathname}</span>
    </>
  )
}

/**
 * The reload is not a nicety and the copy says so. Remotes are registered once
 * per container name and their modules are already evaluated, so nothing about
 * an override applies until the page boots again.
 */
function PendingFooter({
  pending,
  canApply,
  hasOverrides,
  onApply,
}: {
  readonly pending: number
  readonly canApply: boolean
  readonly hasOverrides: boolean
  readonly onApply: () => void
}): ReactNode {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border-subtle bg-card px-3 py-2">
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        {pending === 0
          ? 'Overrides are read at boot, so a change takes a reload.'
          : `${String(pending)} pending ${pending === 1 ? 'change' : 'changes'}.`}
      </p>

      {pending === 0 ? null : (
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            devtools.clearDraft()
          }}
        >
          <XIcon /> Discard
        </Button>
      )}

      {!hasOverrides || pending > 0 ? null : (
        <Button
          variant="outline"
          size="sm"
          onPress={() => {
            devtools.clearDraft()
            if (devtools.apply(browserStorage(), new Map())) window.location.reload()
          }}
        >
          <Trash2Icon /> Clear all
        </Button>
      )}

      <Button size="sm" isDisabled={!canApply} onPress={onApply}>
        Apply and reload
      </Button>
    </div>
  )
}
