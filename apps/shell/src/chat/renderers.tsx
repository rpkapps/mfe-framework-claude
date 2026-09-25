/**
 * The built-in renderers' views: a table, a chart and a summary card, drawn with Tecton from what
 * the call said, parsed by the tool's own schema. Nothing here reads a result's shape to decide
 * how to show it; the tool name decided that.
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
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@tecton/react/components/chart'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tecton/react/components/table'
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'

import type { ChartInput, SummaryInput, TableInput } from './tools/renderers.ts'

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

const SERIES_COLOURS = [1, 2, 3, 4, 5, 1].map(index => `var(--chart-${String(index)})`)

export function ChartView({ input }: { readonly input: ChartInput }): ReactNode {
  const config: ChartConfig = Object.fromEntries(
    input.series.map((series, index) => [
      series.key,
      { label: series.label, color: SERIES_COLOURS[index] ?? 'var(--chart-1)' },
    ]),
  )
  const Chart = input.kind === 'line' ? LineChart : BarChart

  return (
    <Card size="sm" className="gap-2 py-3" data-slot="chat-chart">
      {input.title !== undefined && (
        <CardHeader className="px-3">
          <CardTitle className="text-sm">{input.title}</CardTitle>
          {input.caption !== undefined && <CardDescription>{input.caption}</CardDescription>}
        </CardHeader>
      )}
      <CardContent className="flex flex-col gap-2 px-3">
        <ChartContainer config={config} className="min-h-48 w-full">
          <Chart accessibilityLayer data={input.data}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey={input.x.key} tickLine={false} axisLine={false} tickMargin={8} />
            <YAxis tickLine={false} axisLine={false} width={32} />
            <ChartTooltip content={<ChartTooltipContent />} />
            {input.series.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
            {input.series.map(series =>
              input.kind === 'line' ? (
                <Line
                  key={series.key}
                  dataKey={series.key}
                  stroke={`var(--color-${series.key})`}
                  strokeWidth={2}
                  dot={false}
                />
              ) : (
                <Bar
                  key={series.key}
                  dataKey={series.key}
                  fill={`var(--color-${series.key})`}
                  radius={3}
                />
              ),
            )}
          </Chart>
        </ChartContainer>
        {/* The same figures as a table, for anyone who cannot read the chart. */}
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">The data</summary>
          <TableView
            input={{
              columns: [
                { key: input.x.key, label: input.x.label },
                ...input.series.map(series => ({ ...series, align: 'end' as const })),
              ],
              rows: input.data,
            }}
          />
        </details>
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
