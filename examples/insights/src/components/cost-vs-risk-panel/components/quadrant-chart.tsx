'use client'

import * as React from 'react'
import { cn } from 'cn'
import {
  CartesianGrid,
  Cell,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts'

import { ChartContainer, ChartTooltip, type ChartConfig } from '@tecton/react/components/chart'

import { riskLabel, type DesignPoint } from '../data'

type QuadrantChartProps = React.ComponentProps<'div'> & {
  designs: DesignPoint[]
  /** Ids of the highlighted designs; others are dimmed. */
  selected?: string[]
  xLabel?: string
  yLabel?: string
}

/**
 * Cost (x) vs risk (y) bubble chart split into four quadrants by
 * reference lines at the mid-point of each axis. Bubble area = plan days.
 */
function QuadrantChart({
  className,
  designs,
  selected,
  xLabel = 'Cost',
  yLabel = 'Risk',
  ...props
}: QuadrantChartProps) {
  const config = React.useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        designs.map(design => [design.id, { label: design.name, color: design.color }]),
      ),
    [designs],
  )

  const costs = designs.map(design => design.cost)
  const xMin = Math.floor((Math.min(...costs) - 15) / 10) * 10
  const xMax = Math.ceil((Math.max(...costs) + 15) / 10) * 10
  const xMid = (xMin + xMax) / 2

  return (
    <ChartContainer
      data-slot="quadrant-chart"
      config={config}
      className={cn('aspect-square w-full rounded-md bg-surface-alt/60', className)}
      {...props}
    >
      <ScatterChart margin={{ top: 24, right: 24, bottom: 24, left: 8 }}>
        <CartesianGrid strokeDasharray="2 4" />
        <XAxis
          type="number"
          dataKey="cost"
          name={xLabel}
          domain={[xMin, xMax]}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `$${value}M`}
          fontSize={10}
        />
        <YAxis
          type="number"
          dataKey="risk"
          name={yLabel}
          domain={[0, 100]}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `${value}%`}
          width={36}
          fontSize={10}
        />
        <ZAxis type="number" dataKey="planDays" range={[240, 900]} />
        <ReferenceLine
          x={xMid}
          stroke="var(--border-strong)"
          label={{
            value: `High ${yLabel.toLowerCase()}`,
            position: 'insideTopLeft',
            fill: 'var(--muted-foreground)',
            fontSize: 10,
            dx: 6,
          }}
        />
        <ReferenceLine
          x={xMid}
          stroke="transparent"
          label={{
            value: `Low ${yLabel.toLowerCase()}`,
            position: 'insideBottomLeft',
            fill: 'var(--muted-foreground)',
            fontSize: 10,
            dx: 6,
          }}
        />
        <ReferenceLine
          y={50}
          stroke="var(--border-strong)"
          label={{
            value: `Low ${xLabel.toLowerCase()}`,
            position: 'insideBottomLeft',
            fill: 'var(--muted-foreground)',
            fontSize: 10,
          }}
        />
        <ReferenceLine
          y={50}
          stroke="transparent"
          label={{
            value: `High ${xLabel.toLowerCase()}`,
            position: 'insideBottomRight',
            fill: 'var(--muted-foreground)',
            fontSize: 10,
          }}
        />
        <ChartTooltip
          cursor={false}
          content={({ active, payload }) => {
            const point = payload[0]?.payload as DesignPoint | undefined
            if (!active || !point) return null
            return <QuadrantTooltip point={point} />
          }}
        />
        <Scatter data={designs} isAnimationActive={false}>
          {designs.map(design => {
            const dimmed = selected && !selected.includes(design.id)
            return (
              <Cell
                key={design.id}
                fill={design.color}
                fillOpacity={dimmed ? 0.15 : 0.55}
                stroke={design.color}
                strokeOpacity={dimmed ? 0.4 : 1}
                strokeWidth={design.isRecommended ? 2 : 1}
              />
            )
          })}
        </Scatter>
      </ScatterChart>
    </ChartContainer>
  )
}

function QuadrantTooltip({ point }: { point: DesignPoint }) {
  return (
    <div className="grid min-w-36 gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="flex items-center gap-1.5 font-medium">
        <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: point.color }} />
        {point.name}
        {point.isRecommended && (
          <span className="ml-auto text-[0.625rem] text-muted-foreground">Recommended</span>
        )}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
        <dt>Cost</dt>
        <dd className="text-right font-mono text-foreground tabular-nums">
          ${point.costRange[0]}–{point.costRange[1]}M
        </dd>
        <dt>Risk</dt>
        <dd className="text-right font-mono text-foreground tabular-nums">
          {point.risk}% · {riskLabel(point.risk)}
        </dd>
        <dt>Plan days</dt>
        <dd className="text-right font-mono text-foreground tabular-nums">{point.planDays}d</dd>
      </dl>
    </div>
  )
}

export { QuadrantChart, QuadrantTooltip }
export type { QuadrantChartProps }
