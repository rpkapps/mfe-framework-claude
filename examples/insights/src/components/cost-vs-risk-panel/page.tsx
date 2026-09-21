'use client'

import * as React from 'react'
import { cn } from 'cn'
import { CrownIcon, PanelRightIcon, PanelRightOpenIcon } from 'lucide-react'

import { Button } from '@tecton/react/components/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@tecton/react/components/select'
import { Chip, ChipGroup, ChipList } from '@tecton/react/tecton/chip'
import {
  Panel,
  PanelActions,
  PanelContent,
  PanelHeader,
  PanelTitle,
} from '@tecton/react/tecton/panel'

import { ComparisonList } from './components/comparison-list'
import { QuadrantChart } from './components/quadrant-chart'
import { axisOptions, designs as allDesigns, metrics } from './data'
import type { DesignPoint } from './data'

type CostVsRiskPanelProps = Omit<React.ComponentProps<typeof Panel>, 'children'> & {
  designs?: DesignPoint[]
  defaultSelected?: string[]
  onCollapse?: () => void
}

function CostVsRiskPanel({
  className,
  designs = allDesigns,
  defaultSelected = ['initial', 'liner'],
  onCollapse,
  ...props
}: CostVsRiskPanelProps) {
  const [selected, setSelected] = React.useState<string[]>(defaultSelected)
  const [xAxis, setXAxis] = React.useState('cost')
  const [yAxis, setYAxis] = React.useState('risk')

  const xLabel = axisOptions.find(option => option.id === xAxis)?.label ?? 'Cost'
  const yLabel = axisOptions.find(option => option.id === yAxis)?.label ?? 'Risk'

  return (
    <Panel data-slot="cost-vs-risk-panel" className={cn('h-full', className)} {...props}>
      <PanelHeader>
        <PanelTitle className="text-base">{selected.length} Selected</PanelTitle>
        <PanelActions>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Collapse panel"
            {...(onCollapse === undefined ? {} : { onPress: onCollapse })}
          >
            <PanelRightIcon />
          </Button>
        </PanelActions>
      </PanelHeader>
      <PanelContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>Compare</span>
          <Select
            aria-label="X axis"
            className="w-28"
            selectedKey={xAxis}
            onSelectionChange={key => setXAxis(String(key))}
          >
            <SelectTrigger variant="filled" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {axisOptions.map(option => (
                <SelectItem key={option.id} id={option.id} textValue={option.label}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span>and</span>
          <Select
            aria-label="Y axis"
            className="w-28"
            selectedKey={yAxis}
            onSelectionChange={key => setYAxis(String(key))}
          >
            <SelectTrigger variant="filled" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {axisOptions.map(option => (
                <SelectItem key={option.id} id={option.id} textValue={option.label}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <QuadrantChart designs={designs} selected={selected} xLabel={xLabel} yLabel={yLabel} />

        <ChipGroup
          data-slot="cost-vs-risk-legend"
          aria-label="Designs"
          selectionMode="multiple"
          disallowEmptySelection
          selectedKeys={selected}
          onSelectionChange={keys =>
            setSelected(
              keys === 'all'
                ? designs.map(design => design.id)
                : designs.filter(design => keys.has(design.id)).map(design => design.id),
            )
          }
        >
          <ChipList>
            {designs.map(design => {
              const active = selected.includes(design.id)
              return (
                <Chip
                  key={design.id}
                  id={design.id}
                  textValue={design.name}
                  size="md"
                  appearance={active ? 'solid' : 'outline'}
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-[2px]"
                    style={{
                      background: design.color,
                      opacity: active ? 1 : 0.6,
                    }}
                  />
                  {design.name}
                  {design.isRecommended && <CrownIcon className="size-3" />}
                </Chip>
              )
            })}
          </ChipList>
        </ChipGroup>

        <ComparisonList metrics={metrics} designs={designs} selected={selected} />
      </PanelContent>
    </Panel>
  )
}

/** Route-ready page: the panel docked on the right of an empty canvas. */
export default function CostVsRiskPanelPage() {
  const [open, setOpen] = React.useState(true)

  return (
    <div
      data-slot="cost-vs-risk-panel-page"
      className="flex h-svh w-full bg-background text-foreground"
    >
      <div className="hidden min-w-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground md:flex">
        Well design comparison
      </div>
      {open ? (
        <div className="flex h-full w-full max-w-md shrink-0 flex-col border-l border-border-subtle">
          <CostVsRiskPanel
            variant="flat"
            className="rounded-none border-0"
            onCollapse={() => setOpen(false)}
          />
        </div>
      ) : (
        <div className="flex h-full shrink-0 flex-col border-l border-border-subtle p-2">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Expand cost vs risk panel"
            onPress={() => setOpen(true)}
          >
            <PanelRightOpenIcon />
          </Button>
        </div>
      )}
    </div>
  )
}

export { CostVsRiskPanel, QuadrantChart, ComparisonList }
export { designs, metrics, axisOptions, riskLabel } from './data'
export type { CostVsRiskPanelProps }
export type { DesignPoint, Metric, MetricCategory, MetricValue } from './data'
