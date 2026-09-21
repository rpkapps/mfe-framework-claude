import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import config from '#mfe/config'
import { fetch } from '#mfe/fetch'
import { Alert, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
import { Button } from '@tecton/react/components/button'
import { Skeleton } from '@tecton/react/components/skeleton'
import type { ReactNode } from 'react'

import { Fields, LabPage, LabSection } from '../lab-page.tsx'

export const Route = createFileRoute('/config')({
  staticData: { breadcrumb: 'Config & fetch' },
  component: Config,
})

function Config(): ReactNode {
  // Disabled until asked: this lab has no API behind it, and the request is the interesting part.
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
        <Fields value={config} />
      </LabSection>

      <LabSection title="An authenticated request" note="#mfe/fetch">
        <p className="text-sm text-muted-foreground">
          Standard <code className="font-mono">fetch</code>. The generated module resolves a
          relative URL against <code className="font-mono">apiBaseUrl</code> and attaches the
          shell&apos;s session — but only to the origins this container declared as APIs, so a token
          cannot leak to a third party by writing a different URL.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            isDisabled={probe.isFetching}
            onPress={() => {
              void probe.refetch()
            }}
          >
            {probe.isFetching ? 'Sending…' : 'Send a probe request'}
          </Button>
          <span className="font-mono text-xs text-muted-foreground">
            GET {String(config.apiBaseUrl)}lab/probe
          </span>
        </div>

        {/*
         * The result keeps the same room whichever way it lands, because a panel that grows when an
         * answer arrives moves the button the reader just pressed.
         */}
        {probe.isFetching ? (
          <div className="flex flex-col gap-2" role="status" aria-label="Waiting for the response">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : probe.error !== null && probe.error !== undefined ? (
          <Alert variant="destructive" appearance="outline">
            <AlertTitle>The probe did not answer</AlertTitle>
            <AlertDescription>
              {probe.error.message} This lab has no API behind it unless one is running at the
              configured base, so a failure here is the expected result — the point is the request
              that went out.
            </AlertDescription>
          </Alert>
        ) : probe.data === undefined ? (
          <p className="text-sm text-muted-foreground">
            Nothing sent yet. The response is rendered here as fields.
          </p>
        ) : (
          <Fields value={probe.data} />
        )}
      </LabSection>
    </LabPage>
  )
}
