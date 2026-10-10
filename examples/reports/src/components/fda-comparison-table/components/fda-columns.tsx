'use client'

import * as React from 'react'
import {
  createColumnHelper,
  createSortedRowModel,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
} from '@tanstack/react-table'
import { cn } from 'cn'
import { CopyIcon, MoreVerticalIcon, PencilIcon, ShareIcon, TrashIcon } from 'lucide-react'

import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import { Checkbox } from '@tecton/react/components/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@tecton/react/components/dropdown-menu'
import { Meter } from '@tecton/react/tecton/meter'
import { useLocale } from '@tecton/react/tecton/provider'

import { formatFirstOil, riskLabel, statusMeta } from '../data'
import type { FieldDevelopmentAlternative } from '../data'

// TanStack Table v9: the features the FDA comparison table uses.
const fdaTableFeatures = tableFeatures({
  rowSelectionFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
})

const columns = createColumnHelper<typeof fdaTableFeatures, FieldDevelopmentAlternative>()

function MonoValue({
  value,
  unit,
  className,
  digits = 1,
  prefix,
}: {
  value: number
  unit?: string
  className?: string
  digits?: number
  prefix?: string
}) {
  const { locale } = useLocale()
  return (
    <span className={cn('font-mono tabular-nums', className)}>
      {prefix}
      {value.toLocaleString(locale, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })}
      {unit && <span className="ms-1 text-[0.85em] text-muted-foreground">{unit}</span>}
    </span>
  )
}

type ColumnCallbacks = {
  onOpen?: ((fda: FieldDevelopmentAlternative) => void) | undefined
  onDuplicate?: (fda: FieldDevelopmentAlternative) => void
  onDelete?: (fda: FieldDevelopmentAlternative) => void
}

/** Column definitions for the FDA comparison table. */
function createFdaColumns(callbacks: ColumnCallbacks = {}) {
  return columns.columns([
    columns.display({
      id: 'select',
      header: ({ table }) => {
        // Checked when every row is selected, mixed when some are.
        const rows = table.getRowModel().rows
        const all = rows.length > 0 && rows.every(row => row.getIsSelected())
        const some = table.getSelectedRowModel().rows.length > 0
        return (
          <Checkbox
            aria-label="Select all rows"
            checked={all}
            indeterminate={some && !all}
            onCheckedChange={checked => {
              if (checked) table.toggleAllRowsSelected(true)
              else table.setRowSelection({})
            }}
          />
        )
      },
      cell: ({ row }) => (
        <Checkbox
          aria-label={`Select row ${row.original.code}`}
          checked={row.getIsSelected()}
          onCheckedChange={checked => row.toggleSelected(checked)}
        />
      ),
      enableSorting: false,
    }),
    columns.display({
      id: 'rank',
      header: 'Rank',
      cell: ({ row }) => (
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-6 w-1.5 shrink-0 rounded-sm"
            style={{ background: row.original.color }}
          />
          <span className="font-mono tabular-nums">{row.index + 1}</span>
        </span>
      ),
    }),
    columns.accessor('code', {
      header: 'FDA',
      cell: ({ row, getValue }) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 font-mono text-muted-foreground">{getValue()}</span>
          <span className="truncate font-medium">{row.original.name}</span>
        </span>
      ),
    }),
    columns.accessor('npv', {
      header: 'NPV',
      cell: ({ getValue }) => (
        <MonoValue value={getValue()} prefix="$" unit="MM" className="text-success" />
      ),
    }),
    columns.accessor('irr', {
      header: 'IRR',
      cell: ({ getValue }) => <MonoValue value={getValue()} unit="%" />,
    }),
    columns.accessor('capex', {
      header: 'CAPEX',
      cell: ({ getValue }) => <MonoValue value={getValue()} prefix="$" unit="MM" />,
    }),
    columns.accessor('peakProduction', {
      header: 'Peak production',
      cell: ({ getValue }) => <MonoValue value={getValue()} unit="Mbbl/d" />,
    }),
    columns.accessor('firstOil', {
      header: 'First oil',
      cell: ({ getValue }) => (
        <span className="font-mono tabular-nums">{formatFirstOil(getValue())}</span>
      ),
    }),
    columns.accessor('risk', {
      header: 'Risk',
      cell: ({ getValue }) => (
        <Meter
          aria-label={`Risk ${riskLabel(getValue())}`}
          value={getValue()}
          color="auto"
          size="sm"
          segments={5}
          valueLabel={riskLabel(getValue())}
          className="w-28 gap-0.5 [&_[data-slot=meter-value]]:text-2xs"
        />
      ),
    }),
    columns.accessor('status', {
      header: 'Status',
      cell: ({ getValue }) => {
        const meta = statusMeta[getValue()]
        return (
          <Badge variant={meta.color} appearance={getValue() === 'archived' ? 'outline' : 'solid'}>
            {meta.label}
          </Badge>
        )
      },
    }),
    columns.display({
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Actions for ${row.original.code}`}
                />
              }
            >
              <MoreVerticalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end">
              <DropdownMenuItem onClick={() => callbacks.onOpen?.(row.original)}>
                <PencilIcon /> Open
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => callbacks.onDuplicate?.(row.original)}>
                <CopyIcon /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem>
                <ShareIcon /> Share
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => callbacks.onDelete?.(row.original)}
              >
                <TrashIcon /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      ),
    }),
  ])
}

export { createFdaColumns, fdaTableFeatures, MonoValue }
export type { ColumnCallbacks }
