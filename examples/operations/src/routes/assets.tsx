import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Badge } from '@tecton/react/components/badge'
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
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderEyebrow,
  PageHeaderTitle,
} from '@tecton/react/tecton/page-header'
import type { ReactNode } from 'react'
import { z } from 'zod'

import { assetsQueryOptions, type Asset } from '../queries/assets.ts'

export const Route = createFileRoute('/assets')({
  staticData: { breadcrumb: 'Assets' },
  // Native search validation. A parent that needs to pass data to this App uses
  // documented search parameters rather than a hidden input channel.
  validateSearch: z.object({ site: z.enum(['north', 'south', 'central']).default('north') }),
  loaderDeps: ({ search }) => ({ site: search.site }),
  loader: ({ context, deps }) => {
    context.mfe.telemetry.debug('Loading assets', { site: deps.site })
    // The loader and the component use the same options, so they share one
    // cache entry instead of fetching twice.
    return context.queryClient.ensureQueryData(assetsQueryOptions(deps.site))
  },
  component: Assets,
})

const STATUS_VARIANT: Record<Asset['status'], 'success' | 'warning' | 'destructive'> = {
  operational: 'success',
  degraded: 'warning',
  offline: 'destructive',
}

function Assets(): ReactNode {
  const { site } = Route.useSearch()
  const navigate = useNavigate()
  const { data } = useSuspenseQuery(assetsQueryOptions(site))

  return (
    <div className="flex flex-col gap-6 px-4 py-6 md:px-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderEyebrow>Operations</PageHeaderEyebrow>
          <PageHeaderTitle>Assets</PageHeaderTitle>
          <PageHeaderDescription>
            Loaded through the generated <code>#mfe/fetch</code>, which resolves the request against
            the API base this deployment configured and attaches the shell&apos;s session to it. The
            site is a search parameter, so this view is linkable and shareable.
          </PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Site</span>
        <Select
          className="w-44"
          selectedKey={site}
          onSelectionChange={key => {
            void navigate({ to: '/assets', search: { site: String(key) as typeof site } })
          }}
        >
          <SelectTrigger aria-label="Site">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem id="north" textValue="north">
              north
            </SelectItem>
            <SelectItem id="south" textValue="south">
              south
            </SelectItem>
            <SelectItem id="central" textValue="central">
              central
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Table aria-label={`Assets at site ${site}`}>
        <TableHeader>
          <TableHead id="name" isRowHeader>
            Asset
          </TableHead>
          <TableHead id="id">Tag</TableHead>
          <TableHead id="status">Status</TableHead>
        </TableHeader>
        <TableBody
          renderEmptyState={() => (
            <div className="py-8 text-center text-muted-foreground">No assets at site {site}.</div>
          )}
        >
          {data.map(asset => (
            <TableRow key={asset.id} id={asset.id}>
              <TableCell>
                <span className="font-medium">{asset.name}</span>
              </TableCell>
              <TableCell>
                <span className="font-mono text-xs text-muted-foreground">{asset.id}</span>
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[asset.status]} appearance="outline">
                  {asset.status}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
