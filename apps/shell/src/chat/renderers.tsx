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
  const rowHeader = input.columns[0]?.key
  return (
    <Card size="sm" className="gap-2 py-3" data-slot="chat-table">
      {input.title !== undefined && (
        <CardHeader className="px-3">
          <CardTitle className="text-sm">{input.title}</CardTitle>
        </CardHeader>
      )}
      <CardContent className="px-3">
        <Table aria-label={input.title ?? 'Table'} className="text-xs">
          <TableHeader>
            <TableRow>
              {input.columns.map(column => (
                <TableHead
                  key={column.key}
                  scope="col"
                  {...(column.align === 'end' ? { className: 'text-end' } : {})}
                >
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {input.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={input.columns.length}>No rows.</TableCell>
              </TableRow>
            ) : (
              input.rows.map((row, index) => (
                // Rows carry no identity of their own; the agent's order is the only one there is.
                <TableRow key={index}>
                  {input.columns.map(column => {
                    const align = column.align === 'end' ? 'text-end tabular-nums' : ''
                    // The first column names the row, so a screen reader reads it with every cell.
                    return column.key === rowHeader ? (
                      <th
                        key={column.key}
                        scope="row"
                        data-slot="table-cell"
                        className={`px-4 py-3 align-middle font-normal whitespace-nowrap ${align === '' ? 'text-start' : align}`}
                      >
                        {format(row[column.key])}
                      </th>
                    ) : (
                      <TableCell key={column.key} {...(align === '' ? {} : { className: align })}>
                        {format(row[column.key])}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
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
