import { createFileRoute } from '@tanstack/react-router'
import { useBasePath, useMfeSignal, useTheme, useUser } from '@company/mfe-react'
import { buildHash, buildTime, contractMajor, definitions } from '#mfe/meta'
import { Badge } from '@tecton/react/components/badge'
import { Stat, StatGroup, StatLabel, StatValue } from '@tecton/react/tecton/stat'
import type { ReactNode } from 'react'

import { LabPage, LabSection, Readout } from '../lab-page.tsx'

export const Route = createFileRoute('/')({
  staticData: { breadcrumb: 'Overview' },
  component: Overview,
})

function Overview(): ReactNode {
  const user = useUser()
  const theme = useTheme()
  const basePath = useBasePath()
  const signal = useMfeSignal()

  return (
    <LabPage
      eyebrow="Framework lab"
      title="What this mount knows about itself"
      description="Everything on this page came from the shell or from this container's own build. None of it was configured by hand, and none of it is available to a page that is not mounted."
      tryThis={
        <>
          Open this App at <code className="font-mono">/lab</code> and then from inside Operations.
          The base path below changes; nothing else does, and no route in this App is written
          against either value.
        </>
      }
    >
      <StatGroup>
        <Stat>
          <StatLabel>Mounted at</StatLabel>
          <StatValue>{basePath}</StatValue>
        </Stat>
        <Stat>
          <StatLabel>Contract major</StatLabel>
          <StatValue>{contractMajor}</StatValue>
        </Stat>
        <Stat>
          <StatLabel>Theme</StatLabel>
          <StatValue>{theme}</StatValue>
        </Stat>
        <Stat>
          <StatLabel>Signed in</StatLabel>
          <StatValue>{user?.name ?? 'nobody'}</StatValue>
        </Stat>
      </StatGroup>

      <LabSection title="This container's build" note="#mfe/meta">
        <p className="text-sm text-muted-foreground">
          Generated at build time, so a deployed bundle can always say which build it is — which is
          the question every incident starts with.
        </p>
        <Readout label="definitions" value={definitions} />
        <Readout label="buildHash" value={buildHash} />
        <Readout label="buildTime" value={buildTime} />
      </LabSection>

      <LabSection title="The mount's lifetime" note="useMfeSignal">
        <p className="text-sm text-muted-foreground">
          One AbortSignal per mount. Background work started outside a loader passes it, and
          unmounting this App aborts it — which is what stops a disposed MFE writing to state that
          no longer exists.
        </p>
        <Readout label="signal.aborted" value={signal.aborted} />
      </LabSection>

      <p className="text-sm text-muted-foreground">
        <Badge variant="secondary">Apps take URLs, Widgets take props.</Badge> Every page in this
        lab is a route, so every one of them is linkable, and the shell restores it on a reload.
      </p>
    </LabPage>
  )
}
