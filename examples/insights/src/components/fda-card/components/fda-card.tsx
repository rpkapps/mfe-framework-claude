'use client'

import * as React from 'react'
import { cn } from 'cn'
import { ChevronRightIcon, CopyIcon, MoreVerticalIcon, ShareIcon, TrashIcon } from 'lucide-react'

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
import { Meter } from '@tecton/react/tecton/meter'
import { Stat, StatGroup, StatLabel, StatValue } from '@tecton/react/tecton/stat'

import { levelLabel, ratingMeta, statusMeta } from '../data'
import type { FdaSummary } from '../data'

type FdaCardProps = Omit<React.ComponentProps<typeof Card>, 'children'> & {
  fda: FdaSummary
  isSelected?: boolean
  onSelectedChange?: (selected: boolean) => void
  onOpen?: (fda: FdaSummary) => void
  onCompare?: (fda: FdaSummary) => void
}

/**
 * Field development alternative card — code + status chip, description,
 * KPI stat group, complexity / risk / emissions meters and footer actions.
 */
function FdaCard({
  className,
  fda,
  isSelected,
  onSelectedChange,
  onOpen,
  onCompare,
  size = 'sm',
  ...props
}: FdaCardProps) {
  const status = statusMeta[fda.status]
  const rating = ratingMeta[fda.rating]

  return (
    <Card
      data-slot="fda-card"
      data-status={fda.status}
      size={size}
      className={cn('gap-3', isSelected && 'ring-primary/60', className)}
      {...props}
    >
      <CardHeader className="items-center">
        <CardTitle className="flex items-center gap-2">
          <Checkbox
            aria-label={`Select ${fda.code}`}
            {...(isSelected === undefined ? {} : { isSelected })}
            {...(onSelectedChange === undefined ? {} : { onChange: onSelectedChange })}
          />
          <span className="font-mono text-sm font-normal tracking-wide text-muted-foreground">
            {fda.code}
          </span>
        </CardTitle>
        <CardAction className="flex items-center gap-1">
          <Badge variant={status.color} appearance="outline">
            {status.label}
          </Badge>
          <DropdownMenuTrigger>
            <Button variant="ghost" size="icon-xs" aria-label="More actions">
              <MoreVerticalIcon />
            </Button>
            <DropdownMenu placement="bottom end">
              <DropdownMenuItem onAction={() => onOpen?.(fda)}>Open</DropdownMenuItem>
              <DropdownMenuItem>
                <CopyIcon /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem>
                <ShareIcon /> Share
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
        <div
          data-slot="fda-card-summary"
          className="flex flex-col gap-1.5 rounded-md bg-surface-alt/70 p-3"
        >
          <h3 className="text-base leading-tight font-medium">{fda.title}</h3>
          <p className="text-xs text-muted-foreground">{fda.description}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">{fda.wells}</span> wells · updated{' '}
            {fda.updatedAt}
          </p>
        </div>

        <SectionHeading
          title="Economics"
          trailing={
            <Badge variant={rating.color} appearance="outline">
              {rating.label}
            </Badge>
          }
          onPress={() => onOpen?.(fda)}
        />
        <StatGroup className="grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 sm:divide-x sm:divide-border-subtle sm:[&>*:not(:first-child)]:pl-4">
          <Stat size="sm">
            <StatLabel>NPV</StatLabel>
            <StatValue unit="mmusd">{fda.economics.npv.toFixed(1)}</StatValue>
          </Stat>
          <Stat size="sm">
            <StatLabel>IRR</StatLabel>
            <StatValue unit="%">{fda.economics.irr.toFixed(1)}</StatValue>
          </Stat>
          <Stat size="sm">
            <StatLabel>CAPEX</StatLabel>
            <StatValue unit="mmusd">{fda.economics.capex.toFixed(1)}</StatValue>
          </Stat>
          <Stat size="sm">
            <StatLabel>First oil</StatLabel>
            <StatValue>{fda.economics.firstOil}</StatValue>
          </Stat>
        </StatGroup>

        <Separator emphasis="subtle" />

        <LevelMeter label="Complexity" value={fda.complexity} onPress={() => onOpen?.(fda)} />
        <Separator emphasis="subtle" />
        <LevelMeter label="Risk" value={fda.risk} onPress={() => onOpen?.(fda)} />
        <Separator emphasis="subtle" />
        <LevelMeter label="Emissions" value={fda.emissions} onPress={() => onOpen?.(fda)} />
      </CardContent>

      <CardFooter className="justify-end gap-2">
        <Button variant="ghost" size="sm" onPress={() => onCompare?.(fda)}>
          Compare
        </Button>
        <Button variant="secondary" size="sm" onPress={() => onOpen?.(fda)}>
          Open
        </Button>
      </CardFooter>
    </Card>
  )
}

function SectionHeading({
  title,
  trailing,
  onPress,
}: {
  title: string
  trailing?: React.ReactNode
  onPress?: (() => void) | undefined
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-muted-foreground">{title}</span>
      <span className="flex items-center gap-1">
        {trailing}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Open ${title.toLowerCase()} details`}
          {...(onPress === undefined ? {} : { onPress })}
        >
          <ChevronRightIcon />
        </Button>
      </span>
    </div>
  )
}

function LevelMeter({
  label,
  value,
  onPress,
}: {
  label: string
  value: number
  onPress?: () => void
}) {
  const level = levelLabel(value)
  return (
    <div data-slot="fda-card-level" className="flex flex-col gap-1.5">
      <SectionHeading
        title={label}
        onPress={onPress}
        trailing={
          <span
            className={cn(
              'font-mono text-xs tabular-nums',
              value >= 67 ? 'text-destructive' : value >= 34 ? 'text-warning' : 'text-success',
            )}
          >
            {level}
          </span>
        }
      />
      <Meter aria-label={`${label}: ${level}`} value={value} color="auto" segments={7} size="sm" />
    </div>
  )
}

export { FdaCard, LevelMeter }
export type { FdaCardProps }
