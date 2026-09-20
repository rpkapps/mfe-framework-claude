// @ts-nocheck
'use client'

import * as React from 'react'
import { cn } from 'cn'

import { Separator } from '@tecton/react/components/separator'
import { Meter } from '@tecton/react/tecton/meter'

import type { DesignPoint, Metric, MetricCategory } from '../data'

type ComparisonListProps = React.ComponentProps<'div'> & {
  metrics: Metric[]
  designs: DesignPoint[]
  /** Ids of designs to show (defaults to all). */
  selected?: string[]
}

/**
 * Stacked comparison of the selected designs per metric: a bold total row
 * followed by category breakdowns, each rendered as a coloured bar.
 */
function ComparisonList({ className, metrics, designs, selected, ...props }: ComparisonListProps) {
  const visible = selected ? designs.filter(design => selected.includes(design.id)) : designs

  return (
    <div data-slot="comparison-list" className={cn('flex flex-col gap-6', className)} {...props}>
      {metrics.map(metric => (
        <section key={metric.id} className="flex flex-col gap-3">
          <ComparisonGroup
            title={metric.label}
            emphasis
            metric={metric}
            category={metric.total}
            designs={visible}
          />
          {metric.categories.map(category => (
            <React.Fragment key={category.id}>
              <Separator emphasis="subtle" />
              <ComparisonGroup
                title={category.label}
                metric={metric}
                category={category}
                designs={visible}
              />
            </React.Fragment>
          ))}
        </section>
      ))}
    </div>
  )
}

function ComparisonGroup({
  title,
  emphasis = false,
  metric,
  category,
  designs,
}: {
  title: string
  emphasis?: boolean
  metric: Metric
  category: MetricCategory
  designs: DesignPoint[]
}) {
  return (
    <div data-slot="comparison-group" className="flex flex-col gap-1.5">
      <h4 className={cn('text-xs font-medium', emphasis && 'text-sm')}>{title}</h4>
      <div className="flex flex-col gap-1">
        {designs.map(design => {
          const entry = category.values[design.id]
          return (
            <ComparisonBar
              key={design.id}
              design={design}
              value={entry.value}
              range={entry.range}
              max={metric.max}
              format={metric.format}
            />
          )
        })}
      </div>
    </div>
  )
}

function ComparisonBar({
  design,
  value,
  range,
  max,
  format,
}: {
  design: DesignPoint
  value: number
  range?: [number, number]
  max: number
  format: (value: number) => string
}) {
  return (
    <div
      data-slot="comparison-bar"
      className="grid grid-cols-[1fr_auto] items-center gap-3"
      style={{ '--series': design.color } as React.CSSProperties}
    >
      <Meter
        aria-label={`${design.name}: ${format(value)}`}
        value={value}
        minValue={0}
        maxValue={max}
        segments={1}
        size="sm"
        className="[&_[data-slot=meter-segment]>span]:bg-(--series)"
      />
      <span className="min-w-20 text-right font-mono text-xs tabular-nums">
        {format(value)}
        {range && <span className="text-muted-foreground"> –{format(range[1])}</span>}
      </span>
    </div>
  )
}

export { ComparisonList, ComparisonGroup, ComparisonBar }
export type { ComparisonListProps }
