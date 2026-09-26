'use client'

import * as React from 'react'
import { cn } from 'cn'
import { SearchIcon, XIcon } from 'lucide-react'

import { Button } from '@tecton/react/components/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@tecton/react/components/input-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@tecton/react/components/select'
import { Chip, ChipGroup, ChipList } from '@tecton/react/tecton/chip'

import { fields, statusMeta, typeMeta } from '../data'
import type { WellStatus, WellType } from '../data'

export type WellsFilter = {
  query: string
  field: string
  type: WellType | 'all'
  statuses: WellStatus[]
}

export const emptyFilter: WellsFilter = {
  query: '',
  field: 'all',
  type: 'all',
  statuses: [],
}

const allStatuses = Object.keys(statusMeta) as WellStatus[]
const allTypes = Object.keys(typeMeta) as WellType[]

const fieldItems = [
  { value: 'all', label: 'All fields' },
  ...fields.map(field => ({ value: field, label: field })),
]
const typeItems = [
  { value: 'all', label: 'All types' },
  ...allTypes.map(type => ({ value: type, label: typeMeta[type] })),
]

type WellsFilterBarProps = Omit<React.ComponentProps<'div'>, 'onChange'> & {
  value: WellsFilter
  onChange: (next: WellsFilter) => void
  /** Number of rows matching the current filter. */
  resultCount?: number
}

function WellsFilterBar({
  className,
  value,
  onChange,
  resultCount,
  ...props
}: WellsFilterBarProps) {
  const set = <TKey extends keyof WellsFilter>(key: TKey, next: WellsFilter[TKey]) =>
    onChange({ ...value, [key]: next })

  const active =
    value.query.trim() !== '' ||
    value.field !== 'all' ||
    value.type !== 'all' ||
    value.statuses.length > 0

  return (
    <div data-slot="wells-filter-bar" className={cn('flex flex-col gap-3', className)} {...props}>
      <div className="flex flex-col gap-3 md:flex-row md:items-end">
        <InputGroup className="md:max-w-xs">
          <InputGroupInput
            aria-label="Search wells"
            placeholder="Search by name, rig or operator…"
            value={value.query}
            onChange={event => set('query', event.target.value)}
          />
          <InputGroupAddon align="inline-start">
            <SearchIcon aria-hidden />
          </InputGroupAddon>
        </InputGroup>
        <Select
          value={value.field}
          onValueChange={next => set('field', next ?? 'all')}
          items={fieldItems}
        >
          <SelectTrigger aria-label="Field" className="md:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fieldItems.map(item => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={value.type}
          onValueChange={next => set('type', next ?? 'all')}
          items={typeItems}
        >
          <SelectTrigger aria-label="Well type" className="md:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {typeItems.map(item => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="md:ml-auto"
            onClick={() => onChange(emptyFilter)}
          >
            <XIcon /> Clear filters
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Status</span>
        <ChipGroup
          aria-label="Status filters"
          selectionMode="multiple"
          value={value.statuses}
          onValueChange={next =>
            set(
              'statuses',
              allStatuses.filter(status => next.includes(status)),
            )
          }
        >
          <ChipList>
            {allStatuses.map(status => {
              const selected = value.statuses.includes(status)
              return (
                <Chip
                  key={status}
                  value={status}
                  size="md"
                  variant={selected ? statusMeta[status].color : 'secondary'}
                  appearance={selected ? 'solid' : 'outline'}
                >
                  {statusMeta[status].label}
                </Chip>
              )
            })}
          </ChipList>
        </ChipGroup>
        {value.statuses.length > 0 && (
          <ChipGroup
            aria-label="Active status filters"
            className="ml-auto"
            onRemove={removed =>
              set(
                'statuses',
                value.statuses.filter(status => !removed.includes(status)),
              )
            }
          >
            <ChipList>
              {value.statuses.map(status => (
                <Chip key={status} value={status}>
                  {statusMeta[status].label}
                </Chip>
              ))}
            </ChipList>
          </ChipGroup>
        )}
        {typeof resultCount === 'number' && (
          <span className="ml-auto font-mono text-xs text-muted-foreground tabular-nums">
            {resultCount} {resultCount === 1 ? 'well' : 'wells'}
          </span>
        )}
      </div>
    </div>
  )
}

export { WellsFilterBar }
export type { WellsFilterBarProps }
