/**
 * The built-in renderers' views: a table and a summary card (the chart is `chart-view.tsx`),
 * drawn with Tecton from what the call said, parsed by the tool's own schema. Nothing here reads
 * a result's shape to decide how to show it; the tool name decided that.
 */

import type { ReactNode } from 'react'
import { Badge } from '@tecton/react/components/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@tecton/react/components/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tecton/react/components/table'

import type { SummaryInput, TableInput } from './tools/renderers.ts'

function format(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return typeof value === 'number' ? value.toLocaleString() : String(value)
}

export function TableView({ input }: { readonly input: TableInput }): ReactNode {
  const rows = input.rows.map((row, index) => ({ id: index, row }))
  return (
    <Card size="sm" className="gap-2 py-3" data-slot="chat-table">
      {input.title !== undefined && (
        <CardHeader className="px-3">
          <CardTitle className="text-sm">{input.title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="px-3">
        <Table aria-label={input.title ?? 'Table'} className="text-xs">
          <TableHeader columns={input.columns}>
            {column => (
              <TableHead
                id={column.key}
                isRowHeader={column.key === input.columns[0]?.key}
                {...(column.align === 'end' ? { className: 'text-end' } : {})}
              >
                {column.label}
              </TableHead>
            )}
          </TableHeader>
          <TableBody items={rows} renderEmptyState={() => 'No rows.'}>
            {item => (
              <TableRow id={item.id} columns={input.columns}>
                {column => (
                  <TableCell
                    {...(column.align === 'end' ? { className: 'text-end tabular-nums' } : {})}
                  >
                    {format(item.row[column.key])}
                  </TableCell>
                )}
              </TableRow>
            )}
          </TableBody>
        </Table>
        {input.caption !== undefined && (
          <p className="mt-2 text-xs text-muted-foreground">{input.caption}</p>
        )}
      </CardContent>
    </Card>
  )
}

const TONE: Readonly<Record<string, 'success' | 'warning' | 'destructive'>> = {
  success: 'success',
  warning: 'warning',
  destructive: 'destructive',
}

export function SummaryView({ input }: { readonly input: SummaryInput }): ReactNode {
  return (
    <Card size="sm" className="gap-2 py-3" data-slot="chat-summary">
      <CardHeader className="px-3">
        <CardTitle className="text-sm">{input.title}</CardTitle>
        {input.summary !== undefined && <CardDescription>{input.summary}</CardDescription>}
      </CardHeader>
      {input.facts.length > 0 && (
        <CardContent className="px-3">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            {input.facts.map(fact => (
              <div key={fact.label} className="contents">
                <dt className="text-muted-foreground">{fact.label}</dt>
                <dd className="min-w-0 wrap-break-word">
                  {fact.tone === undefined || fact.tone === 'default' ? (
                    fact.value
                  ) : (
                    <Badge variant={TONE[fact.tone] ?? 'secondary'}>{fact.value}</Badge>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      )}
    </Card>
  )
}
