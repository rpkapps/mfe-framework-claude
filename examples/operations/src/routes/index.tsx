import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { allow, deny, useCommand, useStoredState, useTheme, useUser } from '@company/mfe-react'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import { Separator } from '@tecton/react/components/separator'
import { Skeleton } from '@tecton/react/components/skeleton'
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
import { FdaCard, fdaSummaries } from '@tecton/react/blocks/fda-card/page.tsx'
import { CopyButton } from '@tecton/react/tecton/copy-button'
import { CheckCircle2Icon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { z } from 'zod'

import { AlertPanel } from '../widgets.ts'

export const Route = createFileRoute('/')({
  staticData: { breadcrumb: 'Overview' },
  component: Overview,
})

// Declared at module scope, as the storage contract requires.
const densitySchema = z.enum(['comfortable', 'compact'])

function Overview(): ReactNode {
  const navigate = useNavigate()
  const user = useUser()
  const theme = useTheme()
  const [acknowledged, setAcknowledged] = useState<string | null>(null)

  // A subscribed value and a stable setter. No effect keeps it in sync, and the
  // value survives a reload because it is stored under this App's own prefix.
  // `retention: 'browser'` deliberately: a display density belongs to the
  // browser rather than to a person, so it is fine for everyone here to share
  // it. Anything derived from the signed-in user takes the 'user' default.
  const [density, setDensity] = useStoredState('table-density', densitySchema, {
    defaultValue: 'comfortable',
    retention: 'browser',
  })

  // Registration is a hook, so mount scoping follows component lifetime: this
  // command appears in the shell's palette while this route is on screen and
  // disappears with it. The inline callbacks need no memoization to stay
  // current.
  useCommand({
    name: 'toggle-density',
    label: `Switch to ${density === 'compact' ? 'comfortable' : 'compact'} density`,
    canExecute: () => (user ? allow() : deny('Sign in to change display preferences.')),
    execute: () => {
      setDensity(current => (current === 'compact' ? 'comfortable' : 'compact'))
    },
  })

  return (
    <div className={`flex flex-col gap-6 px-4 md:px-6 ${density === 'compact' ? 'py-4' : 'py-6'}`}>
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderEyebrow>North Sea · PL 265</PageHeaderEyebrow>
          <PageHeaderTitle className="text-clip whitespace-normal">
            Johan Sverdrup Phase 3
          </PageHeaderTitle>
          <PageHeaderDescription>
            Concept select — comparing tie-back, satellite and platform alternatives against the
            reference case. Signed in as {user?.name ?? 'nobody'}; the {theme} theme and the{' '}
            {density} density both came from outside this application.
          </PageHeaderDescription>
        </PageHeaderContent>
        <PageHeaderActions>
          {/*
           * Share is a link to exactly this page, which is a real action a
           * route-addressable surface can offer. A button that opened nothing
           * would be worse than no button.
           */}
          <CopyButton variant="outline" value={window.location.href}>
            Share
          </CopyButton>
          <Button
            onPress={() => {
              setDensity(current => (current === 'compact' ? 'comfortable' : 'compact'))
            }}
          >
            {density === 'compact' ? 'Comfortable density' : 'Compact density'}
          </Button>
        </PageHeaderActions>
      </PageHeader>

      <StatGroup>
        <Stat>
          <StatLabel>Alternatives</StatLabel>
          <StatValue>{fdaSummaries.length}</StatValue>
        </Stat>
        <Stat>
          <StatLabel>Wells planned</StatLabel>
          <StatValue>14</StatValue>
        </Stat>
        <Stat>
          <StatLabel>Gate</StatLabel>
          <StatValue>DG2</StatValue>
        </Stat>
        <Stat>
          <StatLabel>Density</StatLabel>
          <StatValue>{density}</StatValue>
        </Stat>
      </StatGroup>

      <Separator emphasis="subtle" />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Field development alternatives</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {fdaSummaries.map(fda => (
            <FdaCard
              key={fda.id}
              fda={fda}
              // Both open the Reports application, which is delegated at a
              // route inside this one: opening an alternative is the child
              // App's deep link, and comparing them is its index.
              onOpen={selected => {
                void navigate({
                  to: '/reports/$',
                  params: { _splat: `accounts/${selected.id}` },
                })
              }}
              onCompare={() => {
                void navigate({ to: '/reports/$', params: { _splat: '' } })
              }}
            />
          ))}
        </div>
      </section>

      <Panel>
        <PanelHeader>
          <PanelTitle>Operations alerts</PanelTitle>
          <Badge variant="secondary">from another container</Badge>
        </PanelHeader>
        <PanelContent className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            The panel below is a Widget served by a different deployment. It is consumed here as an
            ordinary component: its inputs are props and its events are <code>onX</code> props.
          </p>

          {/*
           * Inputs go in as props, events come back as onX props. The contract
           * is imported from the provider's own contracts entry, so both are
           * typed and both are validated at the boundary.
           */}
          <AlertPanel
            alertId="a-1001"
            severity="warning"
            pending={
              <div
                role="status"
                aria-label="Loading the alert panel"
                className="flex min-h-24 flex-col gap-2 rounded-lg border border-border-subtle p-3"
              >
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-8 w-40 self-end" />
              </div>
            }
            onAcknowledged={event => {
              setAcknowledged(event.acknowledgedAt)
            }}
            fallback={({ error, retry }) => (
              <div role="alert" className="rounded-md border border-destructive/40 p-4">
                <p className="text-sm whitespace-pre-wrap">{error.message}</p>
                <Button variant="outline" size="sm" className="mt-2" onPress={retry}>
                  Retry
                </Button>
              </div>
            )}
          />

          {acknowledged === null ? null : (
            <p className="flex items-center gap-1.5 text-sm text-success-surface-foreground">
              <CheckCircle2Icon className="size-4" />
              Acknowledged at {acknowledged}.
            </p>
          )}
        </PanelContent>
      </Panel>
    </div>
  )
}
