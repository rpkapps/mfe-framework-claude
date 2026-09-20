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
 * Everything structural is the design system's. Rows are `Item`, the origin is
 * a `Field` around an `InputGroup`, a conflict is an `Alert`, an empty registry
 * is `Empty`, and the pending bar is `ActionBar` — which exists for precisely
 * this case, per its own doc comment: "unsaved changes in a form". Earlier
 * versions of this file built all five out of `div`s and utility classes, and
 * that is how it ended up first as a stack of look-alike cards and then as a
 * wall of identical text boxes. The components already know what a row and a
 * field are meant to look like here; the hand-rolled version was only ever
 * going to approximate them.
 *
 * What stays local is the *state* colouring — a left edge and a tinted media
 * slot per row — because "this one is overridden" is a fact about the override
 * map rather than a variant the design system has an opinion about.
 */

import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
import { Button } from '@tecton/react/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@tecton/react/components/empty'
import { Field, FieldDescription } from '@tecton/react/components/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@tecton/react/components/input-group'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@tecton/react/components/item'
import { ActionBar, ActionBarActions, ActionBarMessage } from '@tecton/react/tecton/action-bar'
import {
  AppWindowIcon,
  ArrowRightIcon,
  BoxIcon,
  LayersIcon,
  PencilIcon,
  RotateCcwIcon,
  ServerIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react'

import { browserStorage } from '../browser-storage.ts'
import { devtools, resolvedOverrides } from '../devtools-store.ts'
import { OriginText } from './origin-text.tsx'
import { conflictingContainers, manifestUrlFor, validateDraft } from './override-draft.ts'
import { useActiveOverrides, useContainerLookup, useRegistryEntries } from './use-devtools.ts'

/** What a row is: untouched, overridden at boot, edited since, or unusable. */
type RowState = 'default' | 'overridden' | 'pending' | 'invalid'

/**
 * Columns, not rows stretched across the panel.
 *
 * A bottom dock on a wide monitor gave every row the full width: an id at the
 * far left, a port at the far right, and a thousand pixels of nothing in
 * between. No row background carries the eye that far, which is the same
 * reason a table that wide needs rules. `auto-fill` holds each track between
 * about 22rem and 44rem whatever the panel is doing, so width buys more rows on
 * screen rather than longer ones — and `min(100%, …)` means a 320px left dock
 * still gets one column, with no breakpoint anywhere.
 *
 * Tracks, not `auto-fit`: `auto-fit` collapses the empty ones, so two entries
 * on a wide screen would stretch back to half the panel each.
 */
const ROW_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))]'

/**
 * The left edge carries the state. A 2px rule the eye finds in a list of eight
 * is worth more than a word that has to be read in each one, and every row
 * declares the border so nothing shifts as a row changes state.
 */
const ROW_ACCENT: Readonly<Record<RowState, string>> = {
  default: '',
  overridden: 'border-l-2 border-l-warning bg-warning-surface/25',
  pending: 'border-l-2 border-l-info bg-info-surface/25',
  invalid: 'border-l-2 border-l-destructive bg-destructive-surface/25',
}

const ROW_MEDIA: Readonly<Record<RowState, string>> = {
  default: 'text-muted-foreground',
  overridden: 'text-warning',
  pending: 'text-info',
  invalid: 'text-destructive',
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
        <DevServerField origin={origin} onOriginChange={setOrigin} resolved={devServerUrl} />

        {entries.length === 0 ? (
          <Empty className="max-w-3xl">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LayersIcon />
              </EmptyMedia>
              <EmptyTitle>Nothing is registered</EmptyTitle>
              <EmptyDescription>
                There is nothing to point anywhere. The Registry tab says whether an entry was never
                registered or was rejected, and why.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className={ROW_GRID}>
            {entries.map(entry => {
              const staged = draft.get(entry.id)
              const applied = inForce.get(entry.id)
              const problem = problems.find(candidate => candidate.id === entry.id)?.message
              const state: RowState =
                problem !== undefined
                  ? 'invalid'
                  : staged !== undefined
                    ? 'pending'
                    : applied === undefined
                      ? 'default'
                      : 'overridden'

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
                  problem={problem}
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
          </ItemGroup>
        )}

        {conflicts.map(conflict => (
          <Alert
            key={conflict.container}
            variant="destructive"
            appearance="outline"
            className="max-w-3xl"
          >
            <TriangleAlertIcon />
            <AlertTitle>
              <span className="font-mono">{conflict.container}</span> cannot load from two URLs
            </AlertTitle>
            <AlertDescription>
              One container is registered once, under one name. Point{' '}
              {conflict.entries.map(([id]) => id).join(' and ')} at the same manifest, or only one
              of them will apply.
            </AlertDescription>
          </Alert>
        ))}
      </div>

      <PendingBar
        pending={draft.size}
        inForce={inForce.size}
        canApply={canApply}
        {...(problems[0] === undefined
          ? {}
          : { problem: `${problems[0].id}: ${problems[0].message}` })}
        onApply={() => {
          if (devtools.apply(browserStorage(), inForce)) window.location.reload()
        }}
      />
    </div>
  )
}

/**
 * The shortcut: one origin, then one press on the row you care about.
 *
 * This began as a multi-select — an origin, a toggle per definition, then a
 * "point" button — and the toggles overflowed the panel at any dock width
 * narrow enough to be useful. Typing a port and pressing "use" on one row is
 * both smaller and fewer steps.
 */
function DevServerField({
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

  /*
   * The label is an addon inside the group rather than a `FieldLabel` above or
   * beside it. A docked panel is short, so a label on its own row costs a row
   * of the list; `orientation="horizontal"` instead stranded it at the far left
   * with the input pushed into the right half. Inline, it is one row.
   */
  return (
    <Field className="max-w-md">
      <InputGroup>
        <InputGroupAddon align="inline-start">
          <ServerIcon />
          <InputGroupText>Dev server</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          id="mfe-devtools-origin"
          aria-label="Dev server origin"
          placeholder="3001"
          value={origin}
          onChange={event => {
            onOriginChange(event.target.value)
          }}
          className="font-mono"
        />
      </InputGroup>
      {/*
       * The hint wraps and the URL truncates, which is not the same class list:
       * a sentence under a capped field had its last clause cut off, and a
       * resolved URL wrapped to a second line that moved every row below it.
       */}
      <FieldDescription
        className={isBlank ? '' : isBad ? 'text-destructive' : 'truncate font-mono'}
        {...(isBlank || isBad ? {} : { title: resolved })}
      >
        {isBlank
          ? 'A port is enough — then “use” it on a row. Overrides apply on reload.'
          : isBad
            ? 'Not a URL — try a port, or host:port.'
            : resolved}
      </FieldDescription>
    </Field>
  )
}

/**
 * One definition.
 *
 * `staged` is the pending edit — a string to set, `null` to clear, `undefined`
 * for no edit at all. Not just an empty string, because clearing an override
 * and never having touched one are different intentions, and the bar below
 * counts them differently.
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
  const Icon = isApp ? AppWindowIcon : BoxIcon

  /*
   * The box is the edit mode, and nothing else. Every overridden row used to
   * carry one, which made a list of eight rows a wall of eight text boxes and
   * said "type here" eight times over when the answer was already typed.
   *
   * An unusable value is the exception: leaving the row as text would hide the
   * thing that has to be fixed behind a second click, so the box stays open
   * until what is in it is a URL.
   */
  const showsInput = isEditing || problem !== undefined

  /* What the row will point at once this is applied, and what that displaces. */
  const effective = staged === undefined ? (applied ?? published) : (staged ?? published)
  const replaces = staged === undefined ? undefined : (applied ?? published)

  return (
    <Item
      variant="muted"
      size="xs"
      className={`group h-9 flex-nowrap py-0 ${ROW_ACCENT[state]}`}
      /*
       * Focus leaving the row ends the edit; moving around inside it does not.
       * This sits on the row rather than on the input because pressing "use"
       * moves focus to a button *beside* the input — with the check on the
       * input, that press ended the edit before it landed, and with the input
       * ignoring it the edit then never ended at all.
       */
      onBlur={event => {
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next)) return
        onDone()
      }}
    >
      <ItemMedia variant="icon" className={ROW_MEDIA[state]}>
        <Icon />
      </ItemMedia>

      {/*
       * One line, always, whatever state the row is in — a list whose rows
       * change height as they change state cannot be scanned, and reads as
       * damage rather than as information. The path is dropped to the title
       * attribute: the same `/mf-manifest.json` on every row was most of what
       * made this list look like noise, and the port is what anyone is
       * scanning for.
       */}
      <ItemContent className="min-w-0 flex-row items-center gap-x-2">
        <ItemTitle className="shrink-0 font-mono text-xs">{id}</ItemTitle>

        {showsInput ? (
          <InputGroup className="ml-auto h-6 min-w-0 flex-1">
            <InputGroupInput
              autoFocus
              aria-label={`Manifest URL for ${id}`}
              aria-invalid={problem !== undefined}
              title={problem ?? value}
              placeholder={published}
              value={value}
              onChange={event => {
                devtools.stage(id, event.target.value)
              }}
              className="font-mono text-xs"
            />
            {devServerUrl === undefined || value === devServerUrl ? null : (
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  size="xs"
                  onPress={() => {
                    devtools.stage(id, devServerUrl)
                  }}
                >
                  Use
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        ) : (
          /*
           * The value as text, and as the edit affordance. A row nobody has
           * touched is something to read, so it is not a box; pressing it is
           * how it becomes one, and the pencil that appears on hover says so
           * without adding a control to every row.
           *
           * A pending row states the change on the same line — the old origin,
           * an arrow, the new one. It was two lines and a sentence, which made
           * the one row being worked on the tallest thing on screen.
           */
          <span className="ml-auto flex min-w-0 items-center gap-1 font-mono text-xs">
            {replaces === undefined ? null : (
              <>
                <span className="truncate text-muted-foreground" title={replaces}>
                  <OriginText url={replaces} dim />
                </span>
                <ArrowRightIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
              </>
            )}

            <button
              type="button"
              onClick={onEdit}
              title={effective}
              className="min-w-0 shrink-0 cursor-text truncate rounded px-1 text-right text-muted-foreground hover:bg-ghost-hover hover:text-foreground"
            >
              <OriginText url={effective} />
            </button>
          </span>
        )}
      </ItemContent>

      <ItemActions className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 max-sm:opacity-100">
        {devServerUrl !== undefined && !showsInput ? (
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
        ) : null}

        {staged !== undefined ? (
          <Button
            variant="ghost"
            size="icon-xs"
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
            size="icon-xs"
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
            size="icon-xs"
            aria-label={`Edit the manifest URL for ${id}`}
            onPress={onEdit}
          >
            <PencilIcon />
          </Button>
        )}
      </ItemActions>
    </Item>
  )
}

/**
 * The bar the design system already has for this.
 *
 * `ActionBar` calls itself transient — "rows selected in a table, unsaved
 * changes in a form" — owns its own enter transition and takes Escape to
 * dismiss. So it appears when there is something to act on and not before,
 * which is also why "overrides apply on reload" lives on the field above
 * rather than in a permanent footer that spends a row saying nothing.
 */
function PendingBar({
  pending,
  inForce,
  canApply,
  problem,
  onApply,
}: {
  readonly pending: number
  readonly inForce: number
  readonly canApply: boolean
  readonly problem?: string
  readonly onApply: () => void
}): ReactNode {
  return (
    <ActionBar
      placement="toolbar"
      isOpen={pending > 0 || inForce > 0}
      {...(pending > 0 ? { onDismiss: () => devtools.clearDraft() } : {})}
      className="shrink-0 border-t border-border-subtle"
    >
      {/*
       * Why "apply" is refusing, in the same bar as the button that is
       * refusing. The message used to sit under the offending row, which cost
       * that row a second line and put the reason a panel's width away from
       * the disabled control it explains.
       */}
      <ActionBarMessage className={problem === undefined ? '' : 'text-destructive'}>
        {problem ??
          (pending > 0
            ? `${String(pending)} pending — applied on reload`
            : `${String(inForce)} override${inForce === 1 ? '' : 's'} in force`)}
      </ActionBarMessage>

      <ActionBarActions>
        {pending > 0 ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onPress={() => {
                devtools.clearDraft()
              }}
            >
              Discard
            </Button>
            <Button size="sm" isDisabled={!canApply} onPress={onApply}>
              Apply and reload
            </Button>
          </>
        ) : (
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
      </ActionBarActions>
    </ActionBar>
  )
}
