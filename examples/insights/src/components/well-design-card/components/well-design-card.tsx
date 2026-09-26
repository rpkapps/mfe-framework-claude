'use client'

import * as React from 'react'
import { cn } from 'cn'
import { CopyIcon, CrownIcon, MoreVerticalIcon, PencilIcon, TrashIcon } from 'lucide-react'

import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@tecton/react/components/card'
import { Checkbox } from '@tecton/react/components/checkbox'
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@tecton/react/components/dropdown-menu'
import { Separator } from '@tecton/react/components/separator'
import { CircularProgress } from '@tecton/react/tecton/circular-progress'
import { Meter } from '@tecton/react/tecton/meter'
import { Stat, StatGroup, StatLabel, StatValue } from '@tecton/react/tecton/stat'

import { phaseMeta, riskLabel, trajectoryMeta } from '../data'
import type { WellDesign } from '../data'
import { TrajectorySketch } from './trajectory-sketch'

type WellDesignCardProps = Omit<React.ComponentProps<typeof Card>, 'children'> & {
  design: WellDesign
  isSelected?: boolean
  onSelectedChange?: (selected: boolean) => void
  onView?: (design: WellDesign) => void
  /** Shows an "Ask the assistant" button beside View. */
  onAsk?: (design: WellDesign) => void
}

function WellDesignCard({
  className,
  design,
  isSelected,
  onSelectedChange,
  onView,
  onAsk,
  size = 'sm',
  ...props
}: WellDesignCardProps) {
  const phase = phaseMeta[design.phase]
  const risk = riskLabel(design.risk)

  return (
    <Card
      data-slot="well-design-card"
      data-trajectory={design.trajectory}
      size={size}
      className={cn('gap-3', isSelected && 'ring-primary/60', className)}
      {...props}
    >
      <CardHeader className="items-center">
        <CardTitle className="flex min-w-0 items-center gap-2">
          <Checkbox
            aria-label={`Select ${design.name}`}
            {...(isSelected === undefined ? {} : { isSelected })}
            {...(onSelectedChange === undefined ? {} : { onChange: onSelectedChange })}
          />
          <span className="truncate text-base">{design.name}</span>
          <Badge variant="secondary" appearance="outline">
            {trajectoryMeta[design.trajectory].label}
          </Badge>
        </CardTitle>
        <CardAction>
          <DropdownMenuTrigger>
            <Button variant="ghost" size="icon-xs" aria-label="More actions">
              <MoreVerticalIcon />
            </Button>
            <DropdownMenu placement="bottom end">
              <DropdownMenuItem onAction={() => onView?.(design)}>
                <PencilIcon /> Open design
              </DropdownMenuItem>
              <DropdownMenuItem>
                <CopyIcon /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">
                <TrashIcon /> Delete
              </DropdownMenuItem>
            </DropdownMenu>
          </DropdownMenuTrigger>
        </CardAction>
      </CardHeader>

      <CardContent className="gap-3">
        <div data-slot="well-design-sketch" className="relative rounded-md bg-surface-alt/70 p-3">
          <div className="absolute top-2 left-2 flex items-center gap-1">
            {design.isPrimary && (
              <Badge appearance="outline">
                <CrownIcon /> Primary
              </Badge>
            )}
          </div>
          <span className="absolute top-2 right-2 font-mono text-[0.625rem] text-muted-foreground">
            {design.well}
          </span>
          <TrajectorySketch design={design} className="mt-4" />
        </div>

        <StatGroup className="grid-cols-3 gap-x-3 gap-y-2">
          <Stat size="sm">
            <StatLabel>TD</StatLabel>
            <StatValue unit="ft">{design.td.toLocaleString()}</StatValue>
          </Stat>
          <Stat size="sm">
            <StatLabel>MD</StatLabel>
            <StatValue unit="ft">{design.md.toLocaleString()}</StatValue>
          </Stat>
          <Stat size="sm">
            <StatLabel>Max inc.</StatLabel>
            <StatValue unit="°">{design.maxInclination}</StatValue>
          </Stat>
        </StatGroup>

        <Separator emphasis="subtle" />

        <dl className="flex flex-col gap-1.5 text-xs">
          <ReadoutRow label="AFE cost" value={`$${design.afeCost[0]}M – ${design.afeCost[1]}M`} />
          <ReadoutRow label="Plan days" value={`${design.planDays[0]}d – ${design.planDays[1]}d`} />
          <ReadoutRow label="DDI" value={design.ddi.toFixed(1)} />
          <ReadoutRow label="Kick-off" value={`${design.kickOff.toLocaleString()} ft`} />
        </dl>

        <Separator emphasis="subtle" />

        <div className="flex items-center gap-3">
          <CircularProgress
            aria-label="Design phase progress"
            value={design.progress}
            size="lg"
            showValue
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Design phase</span>
            <span className="truncate text-sm font-medium">{phase.label}</span>
            <span className="text-xs text-muted-foreground">Stage {phase.order} of 4</span>
          </div>
        </div>

        <Meter
          label="Risk"
          aria-label={`Risk: ${risk}`}
          value={design.risk}
          color="auto"
          segments={6}
          size="sm"
          valueLabel={
            <span
              className={cn(
                'font-mono',
                design.risk >= 67
                  ? 'text-destructive'
                  : design.risk >= 34
                    ? 'text-warning'
                    : 'text-success',
              )}
            >
              {risk}
            </span>
          }
        />
      </CardContent>

      <CardFooter className="gap-2">
        <Button className="flex-1" variant="secondary" onPress={() => onView?.(design)}>
          View design
        </Button>
        {onAsk !== undefined && (
          <Button variant="ghost" onPress={() => onAsk(design)}>
            Ask the assistant
          </Button>
        )}
      </CardFooter>
    </Card>
  )
}

function ReadoutRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  )
}

export { WellDesignCard }
export type { WellDesignCardProps }
