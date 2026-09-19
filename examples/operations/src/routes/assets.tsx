import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import {
  Empty,
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
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderEyebrow,
  PageHeaderTitle,
} from '@tecton/react/tecton/page-header'
import { Panel, PanelContent, PanelFooter } from '@tecton/react/tecton/panel'
import { Stat, StatGroup, StatLabel, StatValue } from '@tecton/react/tecton/stat'
import { CopyButton } from '@tecton/react/tecton/copy-button'
import { PackageSearchIcon, RefreshCwIcon } from 'lucide-react'
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

const SITES = ['north', 'south', 'central'] as const

function Assets(): ReactNode {
  const { site } = Route.useSearch()
  const navigate = useNavigate()
  const { data, isFetching, refetch } = useSuspenseQuery(assetsQueryOptions(site))

  const counts = {
    operational: data.filter(asset => asset.status === 'operational').length,
    degraded: data.filter(asset => asset.status === 'degraded').length,
    offline: data.filter(asset => asset.status === 'offline').length,
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-6 md:px-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderEyebrow>Operations</PageHeaderEyebrow>
          <PageHeaderTitle className="text-clip whitespace-normal">Assets</PageHeaderTitle>
          <PageHeaderDescription>
            Loaded through the generated <code>#mfe/fetch</code>, which resolves the request against
            the API base this deployment configured and attaches the shell&apos;s session to it. The
            site is a search parameter, so this view is linkable and shareable.
          </PageHeaderDescription>
        </PageHeaderContent>
        <PageHeaderActions>
          <CopyButton variant="ghost" size="sm" value={window.location.href}>
            Copy link
          </CopyButton>
          <Button
            variant="outline"
            size="sm"
            isDisabled={isFetching}
            onPress={() => {
              void refetch()
            }}
          >
            <RefreshCwIcon /> {isFetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </PageHeaderActions>
      </PageHeader>

      {/*
       * The counts come first: on an operations page the question is "is
       * anything down", and the answer should not require reading a table.
       */}
      <StatGroup>
        <Stat>
          <StatLabel>Assets</StatLabel>
          <StatValue>{data.length}</StatValue>
        </Stat>
        <Stat>
          <StatLabel>Operational</StatLabel>
          <StatValue className="text-success">{counts.operational}</StatValue>
        </Stat>
        <Stat>
          <StatLabel>Degraded</StatLabel>
          <StatValue className={counts.degraded > 0 ? 'text-warning' : ''}>
            {counts.degraded}
          </StatValue>
        </Stat>
        <Stat>
          <StatLabel>Offline</StatLabel>
          <StatValue className={counts.offline > 0 ? 'text-destructive' : ''}>
            {counts.offline}
          </StatValue>
        </Stat>
      </StatGroup>

      <Panel>
        <PanelContent className="p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-3 py-2">
            <Select
              className="w-40"
              selectedKey={site}
              onSelectionChange={key => {
                void navigate({ to: '/assets', search: { site: String(key) as typeof site } })
              }}
            >
              <SelectTrigger aria-label="Site">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SITES.map(option => (
                  <SelectItem key={option} id={option} textValue={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              {data.length} {data.length === 1 ? 'asset' : 'assets'} at site {site}
            </span>
          </div>

          <Table aria-label={`Assets at site ${site}`}>
            <TableHeader>
              <TableHead id="name" isRowHeader>
                Asset
              </TableHead>
              {/*
               * The tag is folded under the name below `sm`. A three-column
               * table on a 390px screen either scrolls sideways or squeezes
               * every column to two characters; neither is the page working.
               */}
              <TableHead id="id" className="hidden sm:table-cell">
                Tag
              </TableHead>
              <TableHead id="status">Status</TableHead>
            </TableHeader>
            <TableBody
              renderEmptyState={() => (
                <Empty className="py-10">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <PackageSearchIcon />
                    </EmptyMedia>
                    <EmptyTitle>No assets at site {site}</EmptyTitle>
                    <EmptyDescription>
                      Nothing is registered against this site. Pick another one above.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            >
              {data.map(asset => (
                <TableRow key={asset.id} id={asset.id}>
                  <TableCell>
                    <span className="flex flex-col">
                      <span className="font-medium">{asset.name}</span>
                      <span className="font-mono text-xs text-muted-foreground sm:hidden">
                        {asset.id}
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
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
        </PanelContent>
        <PanelFooter className="justify-between text-xs text-muted-foreground">
          <span>
            site=<span className="font-mono">{site}</span> · cached for 30 seconds
          </span>
          <span className="hidden sm:inline">
            One cache entry, shared by the route loader and this component.
          </span>
        </PanelFooter>
      </Panel>
    </div>
  )
}
