/**
 * Pointing a definition at a dev server, which is the reason this package exists. An override only
 * takes effect at boot, so an edit here is *pending* until a reload and is shown as a diff against
 * what actually booted rather than as a value that looks live.
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
import { Separator } from '@tecton/react/components/separator'
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
 * Columns, so width buys more rows on screen rather than longer ones, with no breakpoint anywhere.
 * `auto-fill` rather than `auto-fit`, which collapses the empty tracks and stretches two entries
 * back to half the panel each.
 */
const ROW_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,22rem),1fr))]'

/** Every row declares the border, so nothing shifts as a row changes state. */
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
  const active = useActiveOverrides()
  const containerOf = useContainerLookup()

  const [origin, setOrigin] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const devServerUrl = manifestUrlFor(origin)

  const problems = validateDraft(draft)
  const conflicts = conflictingContainers(resolvedOverrides(active, draft), containerOf)
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
              const applied = active.get(entry.id)
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
        active={active.size}
        canApply={canApply}
        {...(problems[0] === undefined
          ? {}
          : { problem: `${problems[0].id}: ${problems[0].message}` })}
        onApply={() => {
          if (devtools.apply(browserStorage(), active)) window.location.reload()
        }}
      />
    </div>
  )
}

/** One origin, then one press on the row you care about; a toggle per definition overflowed a narrow dock. */
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

  // An addon rather than a `FieldLabel`, which would cost a row of the list in a panel this short.
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
      {/* The hint wraps and the URL truncates: a wrapped URL moved every row below it. */}
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
 * `staged` is the pending edit: a string to set, `null` to clear, `undefined` for no edit at all,
 * because clearing an override and never having touched one are counted differently below.
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

  // A box on every overridden row made the list a wall of text boxes; an unusable value is the one
  // exception, because leaving it as text would hide what has to be fixed behind a second click.
  const showsInput = isEditing || problem !== undefined

  /* What the row will point at once this is applied, and what that displaces. */
  const effective = staged === undefined ? (applied ?? published) : (staged ?? published)
  const replaces = staged === undefined ? undefined : (applied ?? published)

  return (
    <Item
      variant="muted"
      size="xs"
      className={`group h-9 flex-nowrap py-0 ${ROW_ACCENT[state]}`}
      // On the row rather than the input, because pressing "use" moves focus to a button beside it.
      onBlur={event => {
        const next = event.relatedTarget
        if (next instanceof Node && event.currentTarget.contains(next)) return
        onDone()
      }}
    >
      <ItemMedia variant="icon" className={ROW_MEDIA[state]}>
        <Icon />
      </ItemMedia>

      {/* One line, always: a list whose rows change height as they change state cannot be scanned. */}
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
           * The value as text, and as the edit affordance: a row nobody has touched is something to
           * read rather than a box. A pending row states the change on the same line, because two
           * lines made the one row being worked on the tallest thing on screen.
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

/** `ActionBar` is transient, so it appears when there is something to act on and not before. */
function PendingBar({
  pending,
  active,
  canApply,
  problem,
  onApply,
}: {
  readonly pending: number
  readonly active: number
  readonly canApply: boolean
  readonly problem?: string
  readonly onApply: () => void
}): ReactNode {
  const isOpen = pending > 0 || active > 0

  return (
    <>
      {/* A real divider rather than a border rule on the bar: `ActionBar`'s toolbar placement is a
          filled, rounded surface with no border of its own, so the line belongs between the list
          and the bar rather than on it. It comes and goes with the bar it divides. */}
      {isOpen ? <Separator className="shrink-0" /> : null}
      <ActionBar
        placement="toolbar"
        isOpen={isOpen}
        {...(pending > 0 ? { onDismiss: () => devtools.clearDraft() } : {})}
        className="shrink-0"
      >
        {/* Why "apply" is refusing, in the same bar as the button that is refusing. */}
        <ActionBarMessage className={problem === undefined ? '' : 'text-destructive'}>
          {problem ??
            (pending > 0
              ? `${String(pending)} pending — applied on reload`
              : `${String(active)} override${active === 1 ? '' : 's'} applied at boot`)}
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
    </>
  )
}
