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
import {
  PageHeader,
  PageHeaderActions,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderEyebrow,
  PageHeaderTitle,
} from '@tecton/react/tecton/page-header'
import { Panel, PanelContent, PanelHeader, PanelTitle } from '@tecton/react/tecton/panel'
import { Stat, StatGroup, StatLabel, StatValue } from '@tecton/react/tecton/stat'
import { CopyButton } from '@tecton/react/tecton/copy-button'
import { ArrowLeftIcon, SearchXIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import {
  WellDesignCard,
  phaseMeta,
  trajectoryMeta,
  wellDesigns,
} from '../components/blocks/well-design-card/page.tsx'

/**
 * Per-instance data arrives through this App's own URL. Mounted at /operations
 * this route is /operations/wells/<id>; mounted anywhere else it moves with the
 * boundary, and nothing in here parses the prefix to find the well id.
 */
export const Route = createFileRoute('/wells/$wellId')({
  component: WellDetail,
})

function WellDetail(): ReactNode {
  const { wellId } = Route.useParams()
  const navigate = useNavigate()
  const design = wellDesigns.find(candidate => candidate.id === wellId)

  if (design === undefined) {
    return (
      <div className="flex flex-col gap-6 px-4 py-6 md:px-6">
        <PageHeader>
          <PageHeaderContent>
            <PageHeaderEyebrow>
              <Link to="/wells" className="inline-flex items-center gap-1 hover:text-foreground">
                <ArrowLeftIcon className="size-3" /> Wells
              </Link>
            </PageHeaderEyebrow>
            <PageHeaderTitle className="text-clip whitespace-normal">{wellId}</PageHeaderTitle>
          </PageHeaderContent>
        </PageHeader>

        <div className="rounded-xl border border-dashed border-border-subtle">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchXIcon />
              </EmptyMedia>
              <EmptyTitle>No design for {wellId}</EmptyTitle>
              <EmptyDescription>
                This well has no design of record yet. The URL is this application&apos;s contract,
                so an unknown id is this application&apos;s to report.
              </EmptyDescription>
            </EmptyHeader>
            <Button
              variant="outline"
              onPress={() => {
                void navigate({ to: '/wells' })
              }}
            >
              Back to wells
            </Button>
          </Empty>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-6 md:px-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderEyebrow>
            <Link to="/wells" className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeftIcon className="size-3" /> Wells
            </Link>
          </PageHeaderEyebrow>
          <PageHeaderTitle className="text-clip whitespace-normal">{design.name}</PageHeaderTitle>
          <PageHeaderDescription>
            Design of record for {design.well}. A deep link the shell restores on a page load: the
            boundary belongs to the shell and everything after it belongs to this application.
          </PageHeaderDescription>
        </PageHeaderContent>
        <PageHeaderActions>
          <CopyButton variant="ghost" size="sm" value={window.location.href}>
            Copy link
          </CopyButton>
          <Button
            variant="outline"
            size="sm"
            onPress={() => {
              void navigate({ to: '/wells' })
            }}
          >
            All wells
          </Button>
        </PageHeaderActions>
      </PageHeader>

      <StatGroup>
        <Stat>
          <StatLabel>Total depth</StatLabel>
          <StatValue unit="ft">{design.td.toLocaleString()}</StatValue>
        </Stat>
        <Stat>
          <StatLabel>Measured depth</StatLabel>
          <StatValue unit="ft">{design.md.toLocaleString()}</StatValue>
        </Stat>
        <Stat>
          <StatLabel>Max inclination</StatLabel>
          <StatValue unit="°">{design.maxInclination}</StatValue>
        </Stat>
        <Stat>
          <StatLabel>AFE cost</StatLabel>
          <StatValue unit="$M">
            {design.afeCost[0]}–{design.afeCost[1]}
          </StatValue>
        </Stat>
      </StatGroup>

      {/*
       * The card is a fixed-width design-system block, so it gets a column of
       * its own and the rest of the width goes to the facts beside it rather
       * than to 900px of background.
       */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <WellDesignCard design={design} />

        <Panel>
          <PanelHeader>
            <PanelTitle>Design of record</PanelTitle>
          </PanelHeader>
          <PanelContent className="flex flex-col gap-4">
            <dl className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle">
              <Row label="Well">{design.well}</Row>
              <Row label="Trajectory">
                <Badge variant="secondary" appearance="outline">
                  {trajectoryMeta[design.trajectory].label}
                </Badge>
              </Row>
              <Row label="Phase">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant="info" appearance="outline">
                    {phaseMeta[design.phase].label}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    stage {phaseMeta[design.phase].order} of 4 · {design.progress}% complete
                  </span>
                </span>
              </Row>
              <Row label="True vertical depth">{design.tvd.toLocaleString()} ft</Row>
              <Row label="Kick-off point">{design.kickOff.toLocaleString()} ft MD</Row>
              <Row label="Directional difficulty">{design.ddi}</Row>
              <Row label="Plan">
                {design.planDays[0]}–{design.planDays[1]} days
              </Row>
              <Row label="Casing programme">
                <span className="flex flex-wrap gap-1">
                  {design.casings.map(casing => (
                    <Badge key={casing.size} variant="outline" className="font-mono">
                      {casing.size}
                    </Badge>
                  ))}
                </span>
              </Row>
            </dl>

            <p className="text-xs text-muted-foreground">
              Every value here came from this application&apos;s own data, keyed by the id in the
              URL. The shell knows the boundary and nothing below it.
            </p>
          </PanelContent>
        </Panel>
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
    <div className="grid gap-0.5 px-3 py-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] sm:items-baseline sm:gap-4">
      <dt className="text-xs text-muted-foreground sm:text-sm">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  )
}
