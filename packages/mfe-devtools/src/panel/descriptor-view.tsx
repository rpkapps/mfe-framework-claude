/**
 * A published descriptor, rendered as fields.
 *
 * This one is deliberately not built from `Item`. A descriptor is read two
 * levels down — inside a disclosure, inside a rejected entry's alert — to find
 * the single field that is wrong, and `Item` is a row component: it brings a
 * media slot, a filled block and 37px of height per pair, which turns six
 * fields into a scroll. What is wanted here is a dense readout, and the
 * design system has no component for one: `Table` is TanStack Table in this
 * workspace, which is a data grid with sorting and pagination.
 *
 * So it is a two-column grid, and the shell reached the same conclusion for the
 * same reason — `apps/shell/src/shell/readout.tsx` is hand-built for exactly
 * this shape. Only the colours come from the system.
 *
 * Showing raw JSON is the tempting shortcut and it is the wrong answer even
 * here: the one wrong field is what somebody is looking for, and
 * `JSON.stringify(…, null, 2)` buries it in punctuation.
 */

import { Fragment, type ReactNode } from 'react'

export function DescriptorView({ source }: { readonly source: unknown }): ReactNode {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return (
      <p className="font-mono text-[11px] break-all">
        <DescriptorValue value={source} />
      </p>
    )
  }

  return (
    <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px] leading-5">
      {Object.entries(source as Record<string, unknown>).map(([name, value]) => (
        <Fragment key={name}>
          <dt className="truncate font-mono text-muted-foreground">{name}</dt>
          <dd className="min-w-0 font-mono break-all">
            <DescriptorValue value={value} />
          </dd>
        </Fragment>
      ))}
    </dl>
  )
}

/** A value rendered for what it is, rather than as the text of its JSON. */
function DescriptorValue({ value }: { readonly value: unknown }): ReactNode {
  if (value === null) return <span className="text-muted-foreground">null</span>
  if (value === undefined) return <span className="text-muted-foreground">not set</span>

  if (typeof value === 'boolean') {
    return <span className={value ? 'text-success' : 'text-muted-foreground'}>{String(value)}</span>
  }

  if (typeof value === 'string' || typeof value === 'number') return <>{String(value)}</>

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">empty</span>
    return (
      <>
        {value.map((item, index) => (
          <Fragment key={index}>
            {index === 0 ? null : <span className="text-muted-foreground">, </span>}
            {typeof item === 'object' ? JSON.stringify(item) : String(item)}
          </Fragment>
        ))}
      </>
    )
  }

  return <span className="text-muted-foreground">{JSON.stringify(value)}</span>
}
