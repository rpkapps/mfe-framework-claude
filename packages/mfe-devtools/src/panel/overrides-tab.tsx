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

import { Fragment, useState, useSyncExternalStore, type ReactNode } from 'react'
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
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
} from '@tecton/react/components/item'
import { ActionBar, ActionBarActions, ActionBarMessage } from '@tecton/react/tecton/action-bar'
import {
  AppWindowIcon,
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

const ROW_MEDIA: Readonly<Record<RowState, string>> = {
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
        <DevServerField origin={origin} onOriginChange={setOrigin} resolved={devServerUrl} />

        {entries.length === 0 ? (
          <Empty>
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
          <ItemGroup className="overflow-hidden rounded-lg border border-border-subtle">
            {entries.map((entry, index) => {
              const staged = draft.get(entry.id)
              const applied = inForce.get(entry.id)
              const state: RowState =
                staged !== undefined ? 'pending' : applied === undefined ? 'default' : 'overridden'

              return (
                <Fragment key={entry.id}>
                  {index === 0 ? null : <ItemSeparator className="my-0" />}
                  <OverrideRow
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
                </Fragment>
              )
            })}
          </ItemGroup>
        )}

        {conflicts.map(conflict => (
          <Alert key={conflict.container} variant="destructive" appearance="outline">
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
    <Field>
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
      <FieldDescription className={isBad ? 'text-destructive' : 'truncate font-mono'}>
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
  const showsInput = isEditing || state !== 'default'
  const Icon = isApp ? AppWindowIcon : BoxIcon

  return (
    <Item size="xs" className={`group rounded-none border-l-2 ${ROW_ACCENT[state]}`}>
      <ItemMedia variant="icon" className={ROW_MEDIA[state]}>
        <Icon />
      </ItemMedia>

      <ItemContent className="gap-1">
        <ItemTitle className="font-mono">{id}</ItemTitle>

        {showsInput ? (
          <InputGroup>
            <InputGroupInput
              autoFocus={isEditing}
              aria-label={`Manifest URL for ${id}`}
              placeholder={published}
              value={value}
              onBlur={onDone}
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
           * The URL as text, and as the edit affordance. A row nobody has
           * touched is something to read, so it is not a box; pressing it is
           * how it becomes one, and the pencil that appears on hover says so
           * without adding a control to every row.
           */
          <button
            type="button"
            onClick={onEdit}
            title={published}
            className="flex min-w-0 cursor-text rounded text-left font-mono text-xs text-muted-foreground hover:bg-ghost-hover"
          >
            <UrlText url={published} />
          </button>
        )}

        {problem === undefined ? null : (
          <ItemDescription className="text-destructive">{problem}</ItemDescription>
        )}

        {staged === undefined ? null : (
          <ItemDescription>
            in force now:{' '}
            <span className="font-mono text-foreground/90">
              {applied ?? 'the published manifest'}
            </span>
          </ItemDescription>
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
      </ItemActions>
    </Item>
  )
}

/**
 * The origin is the part you read; the rest is the same eight times over.
 *
 * Two levels of contrast, not three: one muted token for the scheme and the
 * path, the normal foreground for the host. An earlier version dimmed the
 * button as a whole and then applied `opacity` to the spans inside it, which
 * multiplies — the result was a row whose URL could not be read at all.
 *
 * Only the path may truncate. Truncating the line as a whole is what a narrow
 * dock did before, and it ate the port — which is the entire question a
 * developer opens this list to answer.
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
      <span className="shrink-0">{parsed.protocol}//</span>
      <span className="shrink-0 font-medium text-foreground">{parsed.host}</span>
      <span className="truncate">{parsed.pathname}</span>
    </>
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
  onApply,
}: {
  readonly pending: number
  readonly inForce: number
  readonly canApply: boolean
  readonly onApply: () => void
}): ReactNode {
  return (
    <ActionBar
      placement="toolbar"
      isOpen={pending > 0 || inForce > 0}
      {...(pending > 0 ? { onDismiss: () => devtools.clearDraft() } : {})}
      className="shrink-0 border-t border-border-subtle"
    >
      <ActionBarMessage>
        {pending > 0
          ? `${String(pending)} pending — applied on reload`
          : `${String(inForce)} override${inForce === 1 ? '' : 's'} in force`}
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
