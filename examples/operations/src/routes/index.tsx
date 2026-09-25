import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { allow, deny, useAction, useStoredState, useTheme, useUser } from '@company/mfe-react'
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
import { CopyButton } from '@tecton/react/tecton/copy-button'
import { CheckCircle2Icon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { z } from 'zod'

import { FdaCard, fdaSummaries } from '../components/fda-card/page.tsx'
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

  // `retention: 'browser'` deliberately: a display density belongs to the browser rather than to a
  // person, so everyone here shares it, and anything derived from the user takes 'user' (§21).
  const [density, setDensity] = useStoredState('table-density', densitySchema, {
    defaultValue: 'comfortable',
    retention: 'browser',
  })

  // Registration is a hook, so this action is in the shell's palette while this route is on screen
  // and gone with it.
  useAction({
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
              // Both open the Reports App, delegated at a route inside this one.
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
            ordinary component: its inputs are props and its outputs are <code>onX</code> props.
          </p>

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
            onAcknowledged={payload => {
              setAcknowledged(payload.acknowledgedAt)
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
