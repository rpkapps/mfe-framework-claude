/**
 * The frame every lab page shares: what the page demonstrates, what to try, and
 * a readout of what actually happened.
 *
 * The readout vocabulary is the substance of this file. Every page here exists
 * to show a value the framework produced, and the obvious way to show one —
 * `JSON.stringify(value, null, 2)` in a `<pre>` — is the wrong one. It turns a
 * user into a string of braces, a list of groups into a bracketed column, and a
 * boolean into a word that looks exactly like the string next to it; it scrolls
 * sideways on a phone; and it makes a framework whose whole claim is "these are
 * ordinary typed values" look like a debugger. So values get presentations:
 * labelled rows, a tag per member, a state word for a boolean, and monospace
 * kept for the things that really are identifiers.
 *
 * Shared so each page is only the feature it is about. Components only, so an
 * edit to a lab page hot-updates instead of reloading the shell around it.
 */

import { Badge } from '@tecton/react/components/badge'
import { Separator } from '@tecton/react/components/separator'
import { Skeleton } from '@tecton/react/components/skeleton'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderEyebrow,
  PageHeaderTitle,
} from '@tecton/react/tecton/page-header'
import {
  Panel,
  PanelActions,
  PanelContent,
  PanelHeader,
  PanelTitle,
} from '@tecton/react/tecton/panel'
import { CopyButton } from '@tecton/react/tecton/copy-button'
import { MinusIcon, MousePointerClickIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function LabPage({
  eyebrow,
  title,
  description,
  tryThis,
  children,
}: {
  readonly eyebrow: string
  readonly title: string
  readonly description: ReactNode
  readonly tryThis: ReactNode
  readonly children: ReactNode
}): ReactNode {
  return (
    // A measure, not a full-bleed column: these pages are prose plus readouts,
    // and a 1900px-wide paragraph is unreadable at any font size.
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderEyebrow>{eyebrow}</PageHeaderEyebrow>
          {/*
           * Tecton's title is one line by design — the header is a single row
           * that collapses its actions rather than stacking. These titles are
           * sentences, and on a phone a single line of one turns into "Identity,
           * groups and theme come…", so this page opts into wrapping.
           */}
          <PageHeaderTitle className="text-2xl text-clip whitespace-normal">
            {title}
          </PageHeaderTitle>
          <PageHeaderDescription>{description}</PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      <p className="flex items-start gap-2.5 rounded-lg border border-border-subtle bg-card p-3 text-sm">
        <MousePointerClickIcon
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <span>
          <span className="font-medium">Try this. </span>
          {tryThis}
        </span>
      </p>

      {children}
    </div>
  )
}

/** A titled area for one experiment on a lab page. */
export function LabSection({
  title,
  note,
  children,
}: {
  readonly title: string
  readonly note?: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <Panel>
      {/*
       * The header wraps rather than truncating. The note beside each title is
       * the API this section is about — `tracer.startActiveSpan`, a long name
       * by design — and on a phone it took enough of the row to turn the title
       * into "Structured lo…", which loses the one word that says what the
       * section is.
       */}
      <PanelHeader className="flex-wrap gap-y-1">
        <PanelTitle className="text-clip whitespace-normal">{title}</PanelTitle>
        {note === undefined ? null : (
          <PanelActions>
            <Badge variant="secondary" appearance="outline" className="font-mono">
              {note}
            </Badge>
          </PanelActions>
        )}
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4">{children}</PanelContent>
    </Panel>
  )
}

/** A boxed list of labelled rows: the shape every readout on these pages takes. */
export function DataList({
  children,
  className = '',
}: {
  readonly children: ReactNode
  readonly className?: string
}): ReactNode {
  return (
    <dl
      className={`divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-background/40 ${className}`}
    >
      {children}
    </dl>
  )
}

/**
 * One row. The label sits above the value on a phone and beside it from `sm`
 * up — a two-column grid at 390px leaves every value a three-word column.
 */
export function DataRow({
  label,
  hint,
  children,
}: {
  readonly label: ReactNode
  readonly hint?: ReactNode
  readonly children: ReactNode
}): ReactNode {
  return (
    <div className="grid gap-0.5 px-3 py-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:items-baseline sm:gap-4">
      <dt className="flex flex-col">
        <span className="font-mono text-xs text-muted-foreground">{label}</span>
        {hint === undefined ? null : (
          <span className="text-xs text-muted-foreground/80">{hint}</span>
        )}
      </dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}

/** An identifier, a URL, a hash: read character by character, and copyable. */
export function Identifier({
  value,
  copy = false,
}: {
  readonly value: string
  readonly copy?: boolean
}): ReactNode {
  return (
    <span className="flex min-w-0 items-center gap-1">
      <code className="min-w-0 font-mono text-xs break-all">{value}</code>
      {copy ? <CopyButton value={value} aria-label="Copy" className="shrink-0" /> : null}
    </span>
  )
}

/** A list of names — groups, definitions, event names. Never a JSON array. */
export function Tags({
  values,
  variant = 'secondary',
  empty = 'none',
}: {
  readonly values: readonly string[]
  readonly variant?: 'secondary' | 'outline' | 'info' | 'success'
  readonly empty?: string
}): ReactNode {
  if (values.length === 0) return <span className="text-sm text-muted-foreground">{empty}</span>

  return (
    <div className="flex flex-wrap gap-1">
      {values.map(value => (
        <Badge key={value} variant={variant} appearance="outline" className="font-mono">
          {value}
        </Badge>
      ))}
    </div>
  )
}

/**
 * A boolean as a state, not a verdict.
 *
 * A dot rather than a tick and a cross: half the booleans on these pages are
 * facts with no good or bad side — `signal.aborted` is false while the mount is
 * healthy, `leavesBoundary` is false for a navigation that stays — and a red ✗
 * beside "live" reads as a failure the page is reporting.
 */
export function Flag({
  value,
  trueLabel = 'true',
  falseLabel = 'false',
}: {
  readonly value: boolean
  readonly trueLabel?: string
  readonly falseLabel?: string
}): ReactNode {
  return (
    <Badge variant={value ? 'success' : 'secondary'} appearance="outline">
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${value ? 'bg-success' : 'bg-muted-foreground'}`}
      />
      {value ? trueLabel : falseLabel}
    </Badge>
  )
}

/** Anything at all, rendered for what it is rather than for what it serialises to. */
export function Value({ value }: { readonly value: unknown }): ReactNode {
  if (value === null || value === undefined)
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <MinusIcon aria-hidden className="size-3" /> not set
      </span>
    )

  if (typeof value === 'boolean') return <Flag value={value} />
  if (typeof value === 'number')
    return <span className="font-mono text-sm tabular-nums">{value}</span>
  if (typeof value === 'string')
    return value === '' ? (
      <span className="text-sm text-muted-foreground">empty</span>
    ) : (
      <Identifier value={value} />
    )

  if (Array.isArray(value)) {
    const members = value as readonly unknown[]
    if (members.every(member => typeof member === 'string' || typeof member === 'number'))
      return <Tags values={members.map(member => String(member))} variant="outline" empty="empty" />

    return (
      <ol className="flex flex-col gap-1">
        {members.map((member, index) => (
          <li key={index} className="flex gap-2">
            <span className="font-mono text-xs text-muted-foreground">{index}</span>
            <Value value={member} />
          </li>
        ))}
      </ol>
    )
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <span className="text-sm text-muted-foreground">empty</span>

    return (
      <dl className="flex flex-col gap-1">
        {entries.map(([name, member]) => (
          <div key={name} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <dt className="font-mono text-xs text-muted-foreground">{name}</dt>
            <dd className="min-w-0">
              <Value value={member} />
            </dd>
          </div>
        ))}
      </dl>
    )
  }

  return <span className="text-sm text-muted-foreground">a {typeof value}</span>
}

/**
 * An object whose keys are not known in advance — a config block, a stored
 * draft, a response body — as one row per field.
 */
export function Fields({ value }: { readonly value: unknown }): ReactNode {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return (
      <DataList>
        <DataRow label="value">
          <Value value={value} />
        </DataRow>
      </DataList>
    )

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">No fields.</p>

  return (
    <DataList>
      {entries.map(([name, member]) => (
        <DataRow key={name} label={name}>
          <Value value={member} />
        </DataRow>
      ))}
    </DataList>
  )
}

/**
 * What happened, in order, with the time it happened at.
 *
 * Several pages here record a running log of what they did — a span ended, an
 * event arrived, a command ran. Joining those lines with `\n` into one
 * monospace block made them a single opaque value; a row each, newest first,
 * with the time in its own column, is the same information read at a glance.
 */
export function EventLog({
  entries,
  empty,
}: {
  readonly entries: readonly {
    readonly at: string
    readonly text: string
    readonly tone?: LogTone
  }[]
  readonly empty: ReactNode
}): ReactNode {
  if (entries.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>

  return (
    <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-background/40">
      {entries.map(entry => (
        <li
          key={`${entry.at}-${entry.text}`}
          className="flex items-start gap-2 px-3 py-2 sm:items-center"
        >
          <span
            aria-hidden
            className={`mt-1.5 size-1.5 shrink-0 rounded-full sm:mt-0 ${TONE_DOT[entry.tone ?? 'default']}`}
          />
          <span className="min-w-0 flex-1 text-sm">{entry.text}</span>
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {entry.at}
          </span>
        </li>
      ))}
    </ul>
  )
}

export type LogTone = 'default' | 'success' | 'warning' | 'destructive'

const TONE_DOT: Record<LogTone, string> = {
  default: 'bg-muted-foreground',
  success: 'bg-success',
  warning: 'bg-warning',
  destructive: 'bg-destructive',
}

/**
 * What a Widget's box holds while its container is on the wire.
 *
 * Handed to the Widget through its `pending` slot, so the wait is contained by
 * the Widget's own boundary: mounting one, or retrying one that failed, used to
 * suspend the whole page and flicker everything back in around it.
 */
export function WidgetSkeleton(): ReactNode {
  return (
    <div
      role="status"
      aria-label="Loading the Widget"
      className="flex min-h-24 flex-col gap-2 rounded-lg border border-border-subtle p-3"
    >
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-8 w-40 self-end" />
    </div>
  )
}

export function LabDivider(): ReactNode {
  return <Separator emphasis="subtle" />
}
