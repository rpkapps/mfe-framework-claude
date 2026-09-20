/**
 * A published descriptor, rendered as fields.
 *
 * The shell has a richer vocabulary for this in `readout.tsx`, and this is
 * deliberately not it. Two of that module's four consumers are production
 * surfaces — the bug report and the dashboard — so moving it here would put a
 * devtools package on the import graph of code that runs for everybody. A few
 * dozen duplicated lines are the cheaper mistake than that inversion.
 *
 * Showing raw JSON is the tempting shortcut and it is the wrong answer even
 * here: a rejected descriptor is read to find the one field that is wrong, and
 * `JSON.stringify(…, null, 2)` buries it in punctuation.
 */

import type { ReactNode } from 'react'

export function DescriptorView({ source }: { readonly source: unknown }): ReactNode {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return (
      <div className="rounded-md border border-border-subtle bg-background/60 p-2">
        <DescriptorValue value={source} />
      </div>
    )
  }

  return (
    <dl className="divide-y divide-border-subtle overflow-hidden rounded-md border border-border-subtle bg-background/60">
      {Object.entries(source as Record<string, unknown>).map(([name, value]) => (
        <div
          key={name}
          className="grid gap-0.5 px-2.5 py-1.5 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:gap-3"
        >
          <dt className="font-mono text-xs text-muted-foreground">{name}</dt>
          <dd className="min-w-0 text-xs">
            <DescriptorValue value={value} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** A value rendered for what it is, rather than as the text of its JSON. */
function DescriptorValue({ value }: { readonly value: unknown }): ReactNode {
  if (value === null) return <span className="text-muted-foreground">null</span>
  if (value === undefined) return <span className="text-muted-foreground">not set</span>

  if (typeof value === 'boolean') {
    return <span className="font-mono">{value ? 'true' : 'false'}</span>
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return <span className="font-mono break-all">{String(value)}</span>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">empty</span>
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((item, index) => (
          <span
            key={index}
            className="rounded border border-border-subtle px-1 font-mono text-[0.7rem]"
          >
            {typeof item === 'object' ? JSON.stringify(item) : String(item)}
          </span>
        ))}
      </span>
    )
  }

  return <span className="font-mono break-all text-muted-foreground">{JSON.stringify(value)}</span>
}
