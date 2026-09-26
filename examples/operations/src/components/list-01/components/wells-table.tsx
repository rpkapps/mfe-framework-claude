'use client'

import * as React from 'react'
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import type { RowSelectionState, SortingState } from '@tanstack/react-table'
import { cn } from 'cn'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  DatabaseIcon,
  MoreVerticalIcon,
  PlusIcon,
} from 'lucide-react'

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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@tecton/react/components/empty'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@tecton/react/components/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tecton/react/components/table'

import { formatDate, statusMeta, typeMeta } from '../data'
import type { Well } from '../data'

// TanStack Table v9: declare the features the wells table uses.
const features = tableFeatures({
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
})

const columns = createColumnHelper<typeof features, Well>()

function createWellColumns(onOpen?: (well: Well) => void) {
  return columns.columns([
    columns.display({
      id: 'select',
      header: ({ table }) => {
        // Checked when every row of the page is selected; mixed when some
        // row (on any page) is. Checking selects every row, unchecking
        // clears the selection.
        const page = table.getRowModel().rows
        const all = page.length > 0 && page.every(row => row.getIsSelected())
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
          aria-label={`Select row ${row.original.name}`}
          checked={row.getIsSelected()}
          onCheckedChange={checked => row.toggleSelected(checked)}
        />
      ),
      enableSorting: false,
    }),
    columns.accessor('name', {
      header: 'Well',
      cell: ({ getValue }) => (
        <span className="font-mono font-medium tabular-nums">{getValue()}</span>
      ),
    }),
    columns.accessor('field', { header: 'Field' }),
    columns.accessor('type', {
      header: 'Type',
      cell: ({ getValue }) => typeMeta[getValue()],
    }),
    columns.accessor('status', {
      header: 'Status',
      cell: ({ getValue }) => {
        const meta = statusMeta[getValue()]
        return (
          <Badge variant={meta.color} appearance="outline">
            {meta.label}
          </Badge>
        )
      },
    }),
    columns.accessor('td', {
      header: 'TD (m MD)',
      cell: ({ getValue }) => (
        <span className="block text-right font-mono tabular-nums">
          {getValue().toLocaleString()}
        </span>
      ),
    }),
    columns.accessor('spud', {
      header: 'Spud',
      cell: ({ getValue }) => (
        <span className="font-mono tabular-nums">{formatDate(getValue())}</span>
      ),
    }),
    columns.accessor('rig', { header: 'Rig' }),
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
                  aria-label={`Actions for ${row.original.name}`}
                />
              }
            >
              <MoreVerticalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end">
              <DropdownMenuItem onClick={() => onOpen?.(row.original)}>Open</DropdownMenuItem>
              <DropdownMenuItem>Add to project</DropdownMenuItem>
              <DropdownMenuItem>Export logs</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">Archive</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      ),
    }),
  ])
}

const pageSizeOptions = [10, 25, 50, 100]

type WellsTableProps = React.ComponentProps<'div'> & {
  data: Well[]
  onOpen?: ((well: Well) => void) | undefined
  pageSize?: number
  onRowSelectionChange?: (selection: RowSelectionState) => void
}

function WellsTable({
  className,
  data,
  onOpen,
  pageSize = 10,
  onRowSelectionChange,
  ...props
}: WellsTableProps) {
  const wellColumns = React.useMemo(() => createWellColumns(onOpen), [onOpen])
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize })

  React.useEffect(() => {
    onRowSelectionChange?.(rowSelection)
  }, [rowSelection, onRowSelectionChange])

  const table = useTable({
    features,
    data,
    columns: wellColumns,
    getRowId: row => row.id,
    state: { sorting, rowSelection, pagination },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPagination,
  })

  const rows = table.getRowModel().rows

  return (
    <div
      data-slot="wells-table"
      className={cn(
        'flex w-full flex-col overflow-hidden rounded-md border bg-card text-sm',
        className,
      )}
      {...props}
    >
      <Table aria-label="Wells">
        <TableHeader className="bg-muted max-md:sr-only [&_tr]:border-border-subtle">
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
                  className={cn('h-11 px-3 text-xs', header.column.id === 'select' && 'w-10')}
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
        <TableBody className="max-md:[&_:is(td,th)]:flex max-md:[&_:is(td,th)]:h-auto max-md:[&_:is(td,th)]:justify-between max-md:[&_:is(td,th)]:py-1.5 max-md:[&_:is(td,th)]:before:text-muted-foreground max-md:[&_:is(td,th)]:before:content-[attr(data-label)] [&_tr]:border-border-subtle max-md:[&_tr]:flex max-md:[&_tr]:flex-col max-md:[&_tr]:py-2 [&_tr:nth-child(even)]:bg-surface-alt/60">
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={table.getFlatHeaders().length}
                className="py-8 text-center text-muted-foreground"
              >
                No results.
              </TableCell>
            </TableRow>
          ) : (
            rows.map(row => (
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
                {row.getAllCells().map(cell => {
                  const label =
                    typeof cell.column.columnDef.header === 'string'
                      ? cell.column.columnDef.header
                      : undefined
                  // The well name names the row: a row header, so a screen
                  // reader reads it with every cell of the row.
                  return cell.column.id === 'name' ? (
                    <th
                      key={cell.id}
                      scope="row"
                      data-slot="table-cell"
                      data-label={label}
                      className="h-11 px-3 py-3 text-start align-middle font-normal whitespace-nowrap"
                    >
                      <table.FlexRender cell={cell} />
                    </th>
                  ) : (
                    <TableCell
                      key={cell.id}
                      data-label={label}
                      className={cn('h-11 px-3', cell.column.id === 'select' && 'w-10')}
                    >
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  )
                })}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <div
        data-slot="wells-table-footer"
        className="flex items-center justify-between gap-3 border-t bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground"
      >
        <span className="tabular-nums">
          {table.getSelectedRowModel().rows.length} of {table.getPrePaginatedRowModel().rows.length}{' '}
          selected
        </span>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span>Rows per page</span>
            <Select
              value={String(pagination.pageSize)}
              onValueChange={value => table.setPageSize(Number(value))}
              items={pageSizeOptions.map(size => ({
                value: String(size),
                label: String(size),
              }))}
            >
              <SelectTrigger aria-label="Rows per page" size="sm" className="h-7 w-18 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map(size => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span className="tabular-nums">
            Page {pagination.pageIndex + 1} of {Math.max(1, table.getPageCount())}
          </span>
          <div className="flex items-center">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Previous page"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Next page"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

type WellsEmptyStateProps = React.ComponentProps<typeof Empty> & {
  /** True when a filter is active (offers "clear filters" instead of "add well"). */
  filtered?: boolean
  onClear?: () => void
  onCreate?: () => void
}

function WellsEmptyState({
  className,
  filtered = false,
  onClear,
  onCreate,
  ...props
}: WellsEmptyStateProps) {
  return (
    <Empty
      data-slot="wells-empty-state"
      className={cn('rounded-md border border-dashed border-border bg-card/50', className)}
      {...props}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <DatabaseIcon />
        </EmptyMedia>
        <EmptyTitle>{filtered ? 'No wells match' : 'No wells yet'}</EmptyTitle>
        <EmptyDescription>
          {filtered
            ? 'Try a different search term, or clear the field, type and status filters.'
            : 'Import wells from the corporate database or create the first planned well.'}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        {filtered ? (
          <Button
            variant="outline"
            size="sm"
            {...(onClear === undefined ? {} : { onClick: onClear })}
          >
            Clear filters
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm">
              Import
            </Button>
            <Button size="sm" {...(onCreate === undefined ? {} : { onClick: onCreate })}>
              <PlusIcon /> New well
            </Button>
          </>
        )}
      </EmptyContent>
    </Empty>
  )
}

export { WellsTable, WellsEmptyState, createWellColumns }
export type { WellsTableProps, WellsEmptyStateProps }
