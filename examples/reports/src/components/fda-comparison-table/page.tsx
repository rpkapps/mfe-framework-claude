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

function FdaComparisonTable({
  className,
  data = allAlternatives,
  onOpen,
  onAddComparison,
  ...props
}: FdaComparisonTableProps) {
  // Copies are numbered by a counter that only grows, so an id is never
  // reused after a row is deleted (the row count would repeat). It shares a
  // state with the rows so a copy reads and advances it in the same update.
  const [{ rows }, setList] = React.useState({ rows: data, copies: 0 })
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})

  const columns = React.useMemo(
    () =>
      createFdaColumns({
        onOpen,
        onDuplicate: fda => {
          setList(current => {
            const copies = current.copies + 1
            return {
              copies,
              rows: [
                ...current.rows,
                {
                  ...fda,
                  id: `${fda.id}-copy-${String(copies)}`,
                  code: `${fda.code} (copy)`,
                  status: 'screening',
                },
              ],
            }
          })
        },
        onDelete: fda => {
          setList(current => ({
            ...current,
            rows: current.rows.filter(row => row.id !== fda.id),
          }))
        },
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
      <Table aria-label="Field development alternatives">
        <TableHeader className="bg-muted [&_tr]:border-border-subtle">
          <tr>
            {table.getFlatHeaders().map(header => {
              const sortable = header.column.getCanSort()
              const sorted = header.column.getIsSorted()
              const content = header.isPlaceholder ? null : <table.FlexRender header={header} />
              return (
                <TableHead
                  key={header.id}
                  aria-sort={
                    !sortable
                      ? undefined
                      : sorted === 'asc'
                        ? 'ascending'
                        : sorted === 'desc'
                          ? 'descending'
                          : 'none'
                  }
                  className={cn('h-9 px-2 text-xs', header.column.id === 'select' && 'w-10')}
                >
                  {sortable ? (
                    // Ascending first, then toggles; one sorted column.
                    <button
                      type="button"
                      className="-mx-1 rounded-sm px-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => header.column.toggleSorting(sorted === 'asc', false)}
                    >
                      {content}
                    </button>
                  ) : (
                    content
                  )}
                </TableHead>
              )
            })}
          </tr>
        </TableHeader>
        <TableBody className="[&_tr]:border-border-subtle [&_tr:nth-child(even)]:bg-surface-alt/60">
          {table.getRowModel().rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={table.getFlatHeaders().length}
                className="py-8 text-center text-muted-foreground"
              >
                No alternatives yet.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map(row => (
              <TableRow
                key={row.id}
                data-selected={row.getIsSelected() ? '' : undefined}
                onClick={event => {
                  // Not a click on the row's checkbox or menu, nor one that
                  // reached it through a portal (the menu's popup).
                  const target = event.target as Element
                  if (
                    !onOpen ||
                    !event.currentTarget.contains(target) ||
                    target.closest('button, a, input, [role=checkbox]')
                  )
                    return
                  onOpen(row.original)
                }}
                className={cn(
                  'hover:bg-accent/60 data-[selected]:bg-accent',
                  onOpen && 'cursor-pointer',
                )}
              >
                {row.getAllCells().map(cell =>
                  // The FDA column names the row: a row header, so a
                  // screen reader reads it with every cell of the row.
                  cell.column.id === 'code' ? (
                    <th
                      key={cell.id}
                      scope="row"
                      data-slot="table-cell"
                      className="h-9 px-2 py-3 text-start align-middle font-normal whitespace-nowrap"
                    >
                      <table.FlexRender cell={cell} />
                    </th>
                  ) : (
                    <TableCell
                      key={cell.id}
                      className={cn('h-9 px-2', cell.column.id === 'select' && 'w-10')}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ),
                )}
              </TableRow>
            ))
          )}
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
          <Button
            variant="ghost"
            size="xs"
            {...(onAddComparison === undefined ? {} : { onClick: onAddComparison })}
          >
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
