/** Values get presentations rather than `JSON.stringify` in a `<pre>`, which makes ordinary typed
 * values look like a debugger. Every export is a component, so an edit hot-updates the page instead
 * of reloading the shell around it (§18). */

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
    // A measure, not a full-bleed column: a 1900px-wide paragraph is unreadable at any font size.
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 md:px-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderEyebrow>{eyebrow}</PageHeaderEyebrow>
          {/*
           * Tecton's title is one line by design and these titles are sentences, so on a phone one
           * would truncate mid-word; this page opts into wrapping instead.
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
       * The note is a long API name, so on a phone it took enough of the row to truncate the title
       * past the one word that says what the section is; the header wraps instead.
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

/** The label sits above the value on a phone, because a two-column grid at 390px leaves every value
 * a three-word column. */
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

/** A list of names — groups, definitions, event names — never a JSON array. */
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

/** A dot rather than a tick and a cross, because half these booleans have no good or bad side and a
 * red cross beside "live" would read as a failure the page is reporting. */
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

/** An object whose keys are not known in advance, as one row per field. */
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

/** A row each, newest first, with the time in its own column, because joining the lines into one
 * monospace block made the log a single opaque value. */
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

/** Handed to the Widget through its `pending` slot, so a mount or a retry suspends that Widget's box
 * rather than the whole page. */
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
