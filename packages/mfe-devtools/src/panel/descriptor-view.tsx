/**
 * A published descriptor, rendered as fields.
 *
 * The shell has a richer vocabulary for this in `readout.tsx`, and this is
 * deliberately not it. Two of that module's four consumers are production
 * surfaces — the bug report and the dashboard — so moving it here would put a
 * devtools package on the import graph of code that runs for everybody.
 *
 * It is an `ItemGroup` of `Item`s rather than a description list built by hand:
 * a key beside a value is what `ItemTitle` and `ItemDescription` are, and the
 * group already owns the dividers and the spacing.
 *
 * Showing raw JSON is the tempting shortcut and it is the wrong answer even
 * here: a rejected descriptor is read to find the one field that is wrong, and
 * `JSON.stringify(…, null, 2)` buries it in punctuation.
 */

import { Fragment, type ReactNode } from 'react'
import { Badge } from '@tecton/react/components/badge'
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemSeparator,
  ItemTitle,
} from '@tecton/react/components/item'

export function DescriptorView({ source }: { readonly source: unknown }): ReactNode {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return (
      <ItemGroup className="overflow-hidden rounded-md border border-border-subtle">
        <Item size="xs">
          <ItemContent>
            <ItemDescription>
              <DescriptorValue value={source} />
            </ItemDescription>
          </ItemContent>
        </Item>
      </ItemGroup>
    )
  }

  return (
    <ItemGroup className="overflow-hidden rounded-md border border-border-subtle">
      {Object.entries(source as Record<string, unknown>).map(([name, value], index) => (
        <Fragment key={name}>
          {index === 0 ? null : <ItemSeparator className="my-0" />}
          <Item size="xs" className="rounded-none">
            <ItemContent className="gap-0.5">
              <ItemTitle className="font-mono text-xs font-normal text-muted-foreground">
                {name}
              </ItemTitle>
              <ItemDescription className="text-foreground">
                <DescriptorValue value={value} />
              </ItemDescription>
            </ItemContent>
          </Item>
        </Fragment>
      ))}
    </ItemGroup>
  )
}

/** A value rendered for what it is, rather than as the text of its JSON. */
function DescriptorValue({ value }: { readonly value: unknown }): ReactNode {
  if (value === null) return <span className="text-muted-foreground">null</span>
  if (value === undefined) return <span className="text-muted-foreground">not set</span>

  if (typeof value === 'boolean') {
    return (
      <Badge variant={value ? 'success' : 'secondary'} size="default">
        {value ? 'true' : 'false'}
      </Badge>
    )
  }

  if (typeof value === 'string' || typeof value === 'number') {
    return <span className="font-mono break-all">{String(value)}</span>
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">empty</span>
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((item, index) => (
          <Badge key={index} variant="outline" size="default" className="font-mono">
            {typeof item === 'object' ? JSON.stringify(item) : String(item)}
          </Badge>
        ))}
      </span>
    )
  }

  return <span className="font-mono break-all text-muted-foreground">{JSON.stringify(value)}</span>
}
