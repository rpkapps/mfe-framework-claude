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
        <InputGroup aria-label="Search wells" className="md:max-w-xs">
          <InputGroupInput
            placeholder="Search by name, rig or operator…"
            value={value.query}
            onChange={event => set('query', event.target.value)}
          />
          <InputGroupAddon align="inline-start">
            <SearchIcon aria-hidden />
          </InputGroupAddon>
        </InputGroup>
        <Select
          aria-label="Field"
          className="md:w-48"
          selectedKey={value.field}
          onSelectionChange={key => set('field', String(key))}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem id="all" textValue="All fields">
              All fields
            </SelectItem>
            {fields.map(field => (
              <SelectItem key={field} id={field} textValue={field}>
                {field}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          aria-label="Well type"
          className="md:w-44"
          selectedKey={value.type}
          onSelectionChange={key => set('type', String(key) as WellsFilter['type'])}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem id="all" textValue="All types">
              All types
            </SelectItem>
            {(Object.keys(typeMeta) as WellType[]).map(type => (
              <SelectItem key={type} id={type} textValue={typeMeta[type]}>
                {typeMeta[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {active && (
          <Button
            variant="ghost"
            size="sm"
            className="md:ml-auto"
            onPress={() => onChange(emptyFilter)}
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
          selectedKeys={value.statuses}
          onSelectionChange={keys =>
            set(
              'statuses',
              keys === 'all' ? allStatuses : allStatuses.filter(status => keys.has(status)),
            )
          }
        >
          <ChipList>
            {allStatuses.map(status => {
              const selected = value.statuses.includes(status)
              return (
                <Chip
                  key={status}
                  id={status}
                  textValue={statusMeta[status].label}
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
            onRemove={keys =>
              set(
                'statuses',
                value.statuses.filter(status => !keys.has(status)),
              )
            }
          >
            <ChipList>
              {value.statuses.map(status => (
                <Chip key={status} id={status} textValue={statusMeta[status].label}>
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
