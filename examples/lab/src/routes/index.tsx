import { createFileRoute } from '@tanstack/react-router'
import { useBasePath, useMfeSignal, useTheme, useUser } from '@company/mfe-react'
import { buildHash, buildTime, contractMajor, definitions } from '#mfe/meta'
import { Badge } from '@tecton/react/components/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@tecton/react/components/table'
import { Stat, StatGroup, StatLabel, StatValue } from '@tecton/react/tecton/stat'
import type { ReactNode } from 'react'

import { DataList, DataRow, Flag, Identifier, LabPage, LabSection } from '../lab-page.tsx'

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
          <StatValue className="truncate">{user?.name ?? 'nobody'}</StatValue>
        </Stat>
      </StatGroup>

      <LabSection title="This container's build" note="#mfe/meta">
        <p className="text-sm text-muted-foreground">
          Generated at build time, so a deployed bundle can always say which build it is — which is
          the question every incident starts with.
        </p>

        {/*
         * Three fields per definition is a table, and an array of JSON objects is a table someone
         * has to reassemble by eye.
         */}
        <Table aria-label="Definitions this container exports">
          <TableHeader>
            <TableHead id="id" isRowHeader>
              Definition
            </TableHead>
            <TableHead id="kind">Kind</TableHead>
            <TableHead id="version">Version</TableHead>
          </TableHeader>
          <TableBody>
            {definitions.map(definition => (
              <TableRow key={definition.id} id={definition.id}>
                <TableCell>
                  <Identifier value={definition.id} />
                </TableCell>
                <TableCell>
                  <Badge
                    variant={definition.kind === 'app' ? 'info' : 'secondary'}
                    appearance="outline"
                  >
                    {definition.kind}
                  </Badge>
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs tabular-nums text-muted-foreground">
                    {definition.version ?? 'unversioned'}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <DataList>
          <DataRow label="buildHash" hint="the commit this bundle came from">
            <Identifier value={buildHash} copy />
          </DataRow>
          <DataRow label="buildTime" hint="when it was produced">
            {formatBuildTime(buildTime)}
          </DataRow>
        </DataList>
      </LabSection>

      <LabSection title="The mount's lifetime" note="useMfeSignal">
        <p className="text-sm text-muted-foreground">
          One AbortSignal per mount. Background work started outside a loader passes it, and
          unmounting this App aborts it — which is what stops a disposed MFE writing to state that
          no longer exists.
        </p>
        <DataList>
          <DataRow label="signal.aborted" hint="true once this mount is disposed">
            <Flag value={signal.aborted} trueLabel="aborted" falseLabel="live" />
          </DataRow>
        </DataList>
      </LabSection>

      <p className="text-sm text-muted-foreground">
        <Badge variant="secondary">Apps take URLs, Widgets take props.</Badge> Every page in this
        lab is a route, so every one of them is linkable, and the shell restores it on a reload.
      </p>
    </LabPage>
  )
}

/** An ISO string is a machine's format, so this renders the reader's locale instead. */
function formatBuildTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}
