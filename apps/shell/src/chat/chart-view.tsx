/**
 * The chart renderer's view, apart from the table and the summary so Recharts loads only when a
 * chart is drawn. Its figures are also listed in a table behind a disclosure.
 */

import type { ReactNode } from 'react'
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
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'

import { TableView } from './renderers.tsx'
import type { ChartInput } from './tools/renderers.ts'

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
      {(input.title !== undefined || input.caption !== undefined) && (
        <CardHeader className="px-3">
          {input.title !== undefined && <CardTitle className="text-sm">{input.title}</CardTitle>}
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
