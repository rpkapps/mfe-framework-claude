import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import config from '#mfe/config'
import { fetch } from '#mfe/fetch'
import { Badge } from '@tecton/react/components/badge'
import { Button } from '@tecton/react/components/button'
import { Spinner } from '@tecton/react/components/spinner'
import type { ReactNode } from 'react'

import { LabPage, LabSection, Readout } from '../lab-page.tsx'

export const Route = createFileRoute('/config')({
  staticData: { breadcrumb: 'Config & fetch' },
  component: Config,
})

function Config(): ReactNode {
  // Disabled until asked: this lab has no API behind it, and the interesting
  // part is the request that goes out, not the response that comes back.
  const probe = useQuery({
    queryKey: ['lab', 'probe'],
    enabled: false,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch('lab/probe', { signal })
      if (!response.ok) throw new Error(`The probe responded ${String(response.status)}.`)
      return (await response.json()) as unknown
    },
  })

  return (
    <LabPage
      eyebrow="Configuration and requests"
      title="Values from the deployment, tokens from the shell"
      description="A container ships no environment values. It declares a schema, the build emits a typed loader and a JSON Schema for the deployment to validate against, and the values arrive at boot from a file next to the container's own assets."
      tryThis={
        <>
          Send the probe request. The response is the development API reporting what arrived: a
          relative path resolved against the configured base rather than against the shell&apos;s
          document, and an Authorization header the request boundary attached — never this
          App&apos;s code.
        </>
      }
    >
      <LabSection title="What this deployment supplied" note="#mfe/config">
        <p className="text-sm text-muted-foreground">
          Typed, validated at boot, and impossible to read before it has loaded. A missing or
          malformed value fails here rather than at the first request that needed it.
        </p>
        <Readout label="config" value={config} />
      </LabSection>

      <LabSection title="An authenticated request" note="#mfe/fetch">
        <p className="text-sm text-muted-foreground">
          Standard <code className="font-mono">fetch</code>. The generated module resolves a
          relative URL against <code className="font-mono">apiBaseUrl</code> and attaches the
          shell&apos;s session — but only to the origins this container declared as APIs, so a token
          cannot leak to a third party by writing a different URL. The response below is the
          development API saying what it received.
        </p>
        <div className="flex items-center gap-2">
          <Button
            onPress={() => {
              void probe.refetch()
            }}
          >
            Send a probe request
          </Button>
          {probe.isFetching ? <Spinner /> : null}
          {probe.isError ? <Badge variant="destructive">failed</Badge> : null}
        </div>
        {probe.data === undefined ? null : <Readout label="response" value={probe.data} />}
        {probe.error === null || probe.error === undefined ? null : (
          <Readout label="error" value={probe.error.message} />
        )}
      </LabSection>
    </LabPage>
  )
}
