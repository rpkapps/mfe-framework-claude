'use client'

import * as React from 'react'
import { cn } from 'cn'
import { DownloadIcon, PlusIcon, UploadIcon } from 'lucide-react'

import { Button } from '@tecton/react/components/button'
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderEyebrow,
  PageHeaderTitle,
} from '@tecton/react/tecton/page-header'

import { emptyFilter, WellsFilterBar } from './components/wells-filter-bar'
import type { WellsFilter } from './components/wells-filter-bar'
import { WellsEmptyState, WellsTable } from './components/wells-table'
import { wells as allWells } from './data'
import type { Well } from './data'

type WellsListPageProps = React.ComponentProps<'div'> & {
  wells?: Well[]
  /** Render the empty-state variant (no wells at all). */
  empty?: boolean
  onOpen?: (well: Well) => void
}

/** Stable empty list for the no-wells variant, so `rows` keeps its memo. */
const noWells: Well[] = []

function applyFilter(wells: Well[], filter: WellsFilter): Well[] {
  const query = filter.query.trim().toLowerCase()
  return wells.filter(well => {
    if (filter.field !== 'all' && well.field !== filter.field) return false
    if (filter.type !== 'all' && well.type !== filter.type) return false
    if (filter.statuses.length > 0 && !filter.statuses.includes(well.status)) return false
    if (
      query &&
      ![well.name, well.rig, well.operator, well.field].some(text =>
        text.toLowerCase().includes(query),
      )
    )
      return false
    return true
  })
}

function WellsListPage({
  className,
  wells = allWells,
  empty = false,
  onOpen,
  ...props
}: WellsListPageProps) {
  const [filter, setFilter] = React.useState<WellsFilter>(emptyFilter)
  const source = empty ? noWells : wells
  const rows = React.useMemo(() => applyFilter(source, filter), [source, filter])
  const filtered = JSON.stringify(filter) !== JSON.stringify(emptyFilter)

  return (
    <div
      data-slot="wells-list-page"
      className={cn(
        'flex min-h-svh w-full flex-col gap-6 bg-background px-4 py-8 text-foreground md:px-8',
        className,
      )}
      {...props}
    >
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderEyebrow>Inventory</PageHeaderEyebrow>
          <PageHeaderTitle>Wells</PageHeaderTitle>
          <PageHeaderDescription>
            All wells across your licences. Select rows to add them to a project or export their
            logs.
          </PageHeaderDescription>
        </PageHeaderContent>
        <PageHeaderActions>
          <Button variant="ghost" size="sm">
            <DownloadIcon /> Export
          </Button>
          <Button variant="outline" size="sm">
            <UploadIcon /> Import
          </Button>
          <Button size="sm">
            <PlusIcon /> New well
          </Button>
        </PageHeaderActions>
      </PageHeader>

      {source.length > 0 && (
        <WellsFilterBar value={filter} onChange={setFilter} resultCount={rows.length} />
      )}

      {rows.length === 0 ? (
        <WellsEmptyState
          filtered={source.length > 0 && filtered}
          onClear={() => setFilter(emptyFilter)}
        />
      ) : (
        <WellsTable data={rows} onOpen={onOpen} />
      )}
    </div>
  )
}

export default function WellsListRoute() {
  return <WellsListPage />
}

export { WellsListPage, WellsFilterBar, WellsTable, WellsEmptyState, applyFilter }
export { wells, statusMeta, typeMeta, fields, formatDate } from './data'
export { emptyFilter } from './components/wells-filter-bar'
export type { WellsListPageProps }
export type { WellsFilter } from './components/wells-filter-bar'
export type { Well, WellStatus, WellType } from './data'
