// @ts-nocheck
'use client'

import * as React from 'react'
import { useTable } from '@tanstack/react-table'
import type { RowSelectionState, SortingState } from '@tanstack/react-table'
import { cn } from 'cn'
import { PlusIcon } from 'lucide-react'

import { Button } from '@tecton/react/components/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tecton/react/components/table'

import { createFdaColumns, fdaTableFeatures, MonoValue } from './components/fda-columns'
import { alternatives as allAlternatives } from './data'
import type { FieldDevelopmentAlternative } from './data'

type FdaComparisonTableProps = React.ComponentProps<'div'> & {
  data?: FieldDevelopmentAlternative[]
  onOpen?: (fda: FieldDevelopmentAlternative) => void
  onAddComparison?: () => void
}

/**
 * FDA comparison table — ranked field development alternatives with mono
 * economics, an auto-coloured risk meter, status badges and a row menu.
 * TanStack Table state (sorting, selection) rendered with the React Aria
 * `Table` primitives in a compact, alternating-row layout.
 */
function FdaComparisonTable({
  className,
  data = allAlternatives,
  onOpen,
  onAddComparison,
  ...props
}: FdaComparisonTableProps) {
  const [rows, setRows] = React.useState(data)
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})

  const columns = React.useMemo(
    () =>
      createFdaColumns({
        onOpen,
        onDuplicate: fda =>
          setRows(current => [
            ...current,
            {
              ...fda,
              id: `${fda.id}-copy-${current.length}`,
              code: `${fda.code} (copy)`,
              status: 'screening',
            },
          ]),
        onDelete: fda => setRows(current => current.filter(row => row.id !== fda.id)),
      }),
    [onOpen],
  )

  const table = useTable({
    features: fdaTableFeatures,
    data: rows,
    columns,
    getRowId: row => row.id,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
  })

  const selectedCount = table.getSelectedRowModel().rows.length

  return (
    <div
      data-slot="fda-comparison-table"
      className={cn(
        'flex w-full flex-col overflow-hidden rounded-md border bg-card text-xs',
        className,
      )}
      {...props}
    >
      <Table
        aria-label="Field development alternatives"
        selectionMode="multiple"
        selectedKeys={table.getSelectedRowModel().rows.map(row => row.id)}
        onSelectionChange={selection => {
          if (selection === 'all') {
            table.toggleAllRowsSelected(true)
          } else {
            table.setRowSelection(
              Object.fromEntries([...selection].map(key => [String(key), true])),
            )
          }
        }}
        sortDescriptor={
          sorting.length
            ? {
                column: sorting[0].id,
                direction: sorting[0].desc ? 'descending' : 'ascending',
              }
            : undefined
        }
        onSortChange={descriptor =>
          table.setSorting([
            {
              id: String(descriptor.column),
              desc: descriptor.direction === 'descending',
            },
          ])
        }
      >
        <TableHeader className="bg-muted [&_tr]:border-border-subtle">
          {table.getFlatHeaders().map(header => (
            <TableHead
              key={header.id}
              id={header.id}
              isRowHeader={header.index === 2}
              allowsSorting={header.column.getCanSort()}
              className={cn('h-9 px-2 text-xs', header.column.id === 'select' && 'w-10')}
            >
              {header.isPlaceholder ? null : <table.FlexRender header={header} />}
            </TableHead>
          ))}
        </TableHeader>
        <TableBody
          renderEmptyState={() => (
            <div className="py-8 text-center text-muted-foreground">No alternatives yet.</div>
          )}
          className="[&_tr:nth-child(even)]:bg-surface-alt/60 [&_tr]:border-border-subtle"
        >
          {table.getRowModel().rows.map(row => (
            <TableRow
              key={row.id}
              id={row.id}
              onAction={() => onOpen?.(row.original)}
              className="hover:bg-accent/60 data-selected:bg-accent"
            >
              {row.getAllCells().map(cell => (
                <TableCell
                  key={cell.id}
                  className={cn('h-9 px-2', cell.column.id === 'select' && 'w-10')}
                >
                  <table.FlexRender cell={cell} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div
        data-slot="fda-comparison-table-footer"
        className="flex items-center justify-between gap-3 border-t bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground"
      >
        <div className="flex items-center gap-2">
          <span className="tabular-nums">
            {selectedCount} of {table.getRowModel().rows.length} selected
          </span>
          <Button variant="ghost" size="xs" onPress={onAddComparison}>
            <PlusIcon /> Add comparison
            {selectedCount > 1 && <span className="text-muted-foreground">({selectedCount})</span>}
          </Button>
        </div>
      </div>
    </div>
  )
}

/** Route-ready page: the table with a small summary header. */
export default function FdaComparisonTablePage() {
  return (
    <div
      data-slot="fda-comparison-table-page"
      className="flex min-h-svh w-full flex-col gap-4 bg-background px-4 py-8 text-foreground md:px-8"
    >
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-medium">Field development alternatives</h1>
        <p className="text-sm text-muted-foreground">
          Ranked by NPV. Select two or more rows to compare cost, schedule and risk side by side.
        </p>
      </header>
      <FdaComparisonTable />
    </div>
  )
}

export { FdaComparisonTable, createFdaColumns, MonoValue }
export { alternatives, statusMeta, riskLabel, formatFirstOil } from './data'
export type { FdaComparisonTableProps }
export type { FieldDevelopmentAlternative, FdaStatus } from './data'
