/**
 * One vocabulary for showing a value the shell knows — labelled rows, a tag per member, a state
 * word for a boolean — because `JSON.stringify` is unreadable on a page someone reads under
 * pressure.
 */

import type { ReactNode } from 'react'
import { Badge } from '@tecton/react/components/badge'
import { MinusIcon } from 'lucide-react'

/** A boxed list of labelled rows. */
export function DataList({
  children,
  className = '',
}: {
  readonly children: ReactNode
  readonly className?: string
}): ReactNode {
  return (
    <dl
      className={`divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle bg-card ${className}`}
    >
      {children}
    </dl>
  )
}

/** The label sits above the value on a phone and beside it from `sm` up: a two-column grid at 390px turns every value into a three-word column. */
export function DataRow({
  label,
  children,
  className = '',
}: {
  readonly label: ReactNode
  readonly children: ReactNode
  readonly className?: string
}): ReactNode {
  return (
    <div
      className={`grid gap-0.5 px-3 py-2 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)] sm:items-baseline sm:gap-4 ${className}`}
    >
      <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}

/** An identifier, a URL, a hash: something that is read character by character. */
export function Mono({
  children,
  className = '',
}: {
  readonly children: ReactNode
  readonly className?: string
}): ReactNode {
  return (
    <span className={`font-mono text-xs break-all text-foreground ${className}`}>{children}</span>
  )
}

/** A list of names — groups, event names, input names. Never a JSON array. */
export function TagRow({
  values,
  variant = 'secondary',
  empty = 'none',
  icon,
}: {
  readonly values: readonly string[]
  readonly variant?: 'secondary' | 'outline' | 'info' | 'warning'
  readonly empty?: string
  readonly icon?: ReactNode
}): ReactNode {
  if (values.length === 0) return <span className="text-sm text-muted-foreground">{empty}</span>

  return (
    <div className="flex flex-wrap gap-1">
      {values.map(value => (
        <Badge key={value} variant={variant} appearance="outline" className="font-mono">
          {icon}
          {value}
        </Badge>
      ))}
    </div>
  )
}

/** A dot rather than a tick and a cross: most booleans crossing this boundary have no good or bad side. */
export function BoolValue({
  value,
  trueLabel = 'yes',
  falseLabel = 'no',
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

/** An arbitrary value from a contract the shell does not know: only something genuinely unrepresentable falls back to a literal. */
export function ValueView({ value }: { readonly value: unknown }): ReactNode {
  if (value === null || value === undefined)
    return (
      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <MinusIcon aria-hidden className="size-3" /> not set
      </span>
    )

  if (typeof value === 'boolean')
    return <BoolValue value={value} trueLabel="true" falseLabel="false" />

  if (typeof value === 'number')
    return <span className="font-mono text-sm tabular-nums">{value}</span>

  if (typeof value === 'string')
    return value === '' ? (
      <span className="text-sm text-muted-foreground">empty</span>
    ) : (
      <Mono className="text-sm">{value}</Mono>
    )

  if (Array.isArray(value)) {
    const members = value as readonly unknown[]
    if (members.every(member => typeof member === 'string' || typeof member === 'number'))
      return (
        <TagRow values={members.map(member => String(member))} variant="outline" empty="empty" />
      )

    return (
      <ol className="flex flex-col gap-1">
        {members.map((member, index) => (
          <li key={index} className="flex gap-2">
            <span className="font-mono text-xs text-muted-foreground">{index}</span>
            <ValueView value={member} />
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
              <ValueView value={member} />
            </dd>
          </div>
        ))}
      </dl>
    )
  }

  // A symbol, a bigint or a function: nothing a published contract should carry, and nothing this page should crash on.
  return <Mono className="text-sm">a {typeof value}</Mono>
}
