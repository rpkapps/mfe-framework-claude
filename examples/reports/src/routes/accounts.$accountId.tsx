import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@tecton/react/components/empty'
import { Meter } from '@tecton/react/tecton/meter'
import { Stat, StatGroup, StatLabel, StatValue } from '@tecton/react/tecton/stat'
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderEyebrow,
  PageHeaderTitle,
} from '@tecton/react/tecton/page-header'
import { Panel, PanelContent, PanelHeader, PanelTitle } from '@tecton/react/tecton/panel'
import { CopyButton } from '@tecton/react/tecton/copy-button'
import { ArrowLeftIcon, SearchXIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { alternatives, statusMeta } from '../components/fda-comparison-table/page.tsx'

/** Per-instance data arrives through this App's own URL contract; the child never parses the mount
 * prefix to find business data. */
export const Route = createFileRoute('/accounts/$accountId')({
  component: AccountReport,
})

function AccountReport(): ReactNode {
  const { accountId } = Route.useParams()
  const navigate = useNavigate()
  const alternative = alternatives.find(candidate => candidate.id === accountId)
  const rank = alternatives.findIndex(candidate => candidate.id === accountId) + 1

  if (alternative === undefined) {
    return (
      <div className="flex flex-col gap-6 px-4 py-6 md:px-6">
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderEyebrow>
              <Link to="/" className="inline-flex items-center gap-1 hover:text-foreground">
                <ArrowLeftIcon className="size-3" /> Alternatives
              </Link>
            </PageHeaderEyebrow>
            <PageHeaderTitle className="text-clip whitespace-normal">{accountId}</PageHeaderTitle>
          </PageHeaderContent>
        </PageHeader>

        <div className="rounded-xl border border-dashed border-border-subtle">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon />
              </EmptyMedia>
              <EmptyTitle>No alternative with that id</EmptyTitle>
              <EmptyDescription>
                The URL is this application&apos;s contract, so an unknown id is this
                application&apos;s to report — not the shell&apos;s.
              </EmptyDescription>
            </EmptyHeader>
            <Button
              variant="outline"
              onPress={() => {
                void navigate({ to: '/' })
              }}
            >
              Back to the ranking
            </Button>
          </Empty>
        </div>
      </div>
    )
  }

  const status = statusMeta[alternative.status]

  return (
    <div className="flex flex-col gap-6 px-4 py-6 md:px-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderEyebrow>
            <Link to="/" className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeftIcon className="size-3" /> Alternatives
            </Link>
          </PageHeaderEyebrow>
          <PageHeaderTitle className="text-clip whitespace-normal">
            {alternative.name}
          </PageHeaderTitle>
          <PageHeaderDescription>
            {alternative.code} · owned by {alternative.owner}. Rendered by the child App, from the
            child App&apos;s own route parameters.
          </PageHeaderDescription>
        </PageHeaderContent>
        <PageHeaderActions>
          <Badge variant={status.color} appearance="outline" size="lg">
            {status.label}
          </Badge>
          <CopyButton variant="ghost" size="sm" value={window.location.href}>
            Copy link
          </CopyButton>
        </PageHeaderActions>
      </PageHeader>

      <StatGroup>
        <Stat>
          <StatLabel>NPV</StatLabel>
          <StatValue unit="$MM">{alternative.npv.toFixed(1)}</StatValue>
        </Stat>
        <Stat>
          <StatLabel>IRR</StatLabel>
          <StatValue unit="%">{alternative.irr.toFixed(1)}</StatValue>
        </Stat>
        <Stat>
          <StatLabel>CAPEX</StatLabel>
          <StatValue unit="$MM">{alternative.capex.toFixed(1)}</StatValue>
        </Stat>
        <Stat>
          <StatLabel>Peak production</StatLabel>
          <StatValue unit="Mbbl/d">{alternative.peakProduction.toFixed(1)}</StatValue>
        </Stat>
      </StatGroup>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader>
            <PanelTitle>Where it ranks</PanelTitle>
          </PanelHeader>
          <PanelContent className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Against the other {alternatives.length - 1} alternatives on the same screening basis.
            </p>
            <Meter
              label="Risk score"
              value={alternative.risk}
              maxValue={100}
              color="auto"
              valueLabel={`${String(alternative.risk)} / 100`}
            />
            <Meter
              label="NPV against the best case"
              value={alternative.npv}
              maxValue={Math.max(...alternatives.map(candidate => candidate.npv))}
              color="success"
              valueLabel={`$${alternative.npv.toFixed(1)}MM`}
            />
            <Meter
              label="CAPEX against the heaviest case"
              value={alternative.capex}
              maxValue={Math.max(...alternatives.map(candidate => candidate.capex))}
              color="warning"
              valueLabel={`$${alternative.capex.toFixed(1)}MM`}
            />
          </PanelContent>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Screening basis</PanelTitle>
          </PanelHeader>
          <PanelContent>
            <dl className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle">
              <Row label="Rank">
                {rank === 0 ? 'unranked' : `${String(rank)} of ${String(alternatives.length)}`}
              </Row>
              <Row label="Code">
                <span className="font-mono text-xs">{alternative.code}</span>
              </Row>
              <Row label="First oil">{formatFirstOil(alternative.firstOil)}</Row>
              <Row label="Owner">{alternative.owner}</Row>
              <Row label="Status">{status.label}</Row>
              <Row label="Route parameter">
                <span className="font-mono text-xs break-all">accountId={accountId}</span>
              </Row>
            </dl>
          </PanelContent>
        </Panel>
      </div>

      <div>
        <Button
          variant="outline"
          onPress={() => {
            void navigate({ to: '/' })
          }}
        >
          Back to the ranking
        </Button>
      </div>
    </div>
  )
}

function Row({
  label,
  children,
}: {
  readonly label: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <div className="grid gap-0.5 px-3 py-2 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:items-baseline sm:gap-4">
      <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}

/** "2029-03" is a machine's date; a reader wants a quarter and a year. */
function formatFirstOil(iso: string): string {
  const [year, month] = iso.split('-')
  if (year === undefined || month === undefined) return iso
  const quarter = Math.floor((Number(month) - 1) / 3) + 1
  return Number.isNaN(quarter) ? iso : `Q${String(quarter)} ${year}`
}
