/**
 * Why the workspace did not open, in Tecton's page-state block (`src/blocks/page-state`, installed
 * from the `@tecton` registry): the status and code, what happened and the one way forward, the
 * reason as the identity provider or the browser gave it, and the well log that stops where the
 * load did. It replaces the loading screen when sign-in, the configuration or the boot fails
 * (`loader.ts`), so it is the first React the page renders, and nothing behind sign-in is in it.
 */

import type { ReactNode } from 'react'
import { Button } from '@tecton/react/components/button'
import { LogInIcon, RotateCcwIcon } from 'lucide-react'

import { LogTrack, LogTrackMarker } from '../blocks/page-state/components/log-track'
import {
  PageState,
  PageStateActions,
  PageStateCode,
  PageStateContent,
  PageStateDescription,
  PageStateFigure,
  PageStateHeader,
  PageStateMeta,
  PageStateMetaItem,
  PageStateStatus,
  PageStateTitle,
  type PageStateTone,
} from '../blocks/page-state/components/page-state'

/** What failed, which decides the status, the code and what the page says to do. */
export type FailureKind = 'sign-in' | 'unreachable' | 'configuration' | 'workspace'

export interface Failure {
  readonly kind: FailureKind
  readonly title: string
  /** The reason as it was given, shown as it is: the one thing support will ask for. */
  readonly detail: string
  readonly actionLabel?: string
  readonly onAction?: () => void
}

interface KindCopy {
  readonly tone: PageStateTone
  readonly status: string
  readonly protocol: string
  readonly code: string
  readonly description: string
  /** Where the log stops, as a share of its depth, and what the marker there says. */
  readonly stopsAt: number
  readonly marker: string
}

const COPY: Readonly<Record<FailureKind, KindCopy>> = {
  'sign-in': {
    tone: 'warning',
    status: 'Sign-in failed',
    protocol: 'OIDC · authorization code',
    code: '401',
    description:
      'The identity provider sent you back, but the sign-in could not be completed. Signing in again usually fixes it; nothing you were working on is lost.',
    stopsAt: 0.58,
    marker: 'SIGN-IN FAILED',
  },
  unreachable: {
    tone: 'destructive',
    status: 'Unreachable',
    protocol: 'OIDC · identity provider',
    code: '503',
    description:
      'The sign-in service did not answer. Check your connection or VPN, then try again.',
    stopsAt: 0.42,
    marker: 'NO RESPONSE',
  },
  configuration: {
    tone: 'destructive',
    status: 'Configuration',
    protocol: 'runtime-config.json',
    code: '500',
    description:
      'This deployment’s settings could not be read, so the workspace cannot start. If it keeps happening, send the reason below to whoever runs this deployment.',
    stopsAt: 0.3,
    marker: 'NOT CONFIGURED',
  },
  workspace: {
    tone: 'destructive',
    status: 'Load failed',
    protocol: 'Workspace',
    code: '500',
    description:
      'Something the workspace needs did not load. Reloading usually fixes it; if it keeps happening, send the reason below to support.',
    stopsAt: 0.66,
    marker: 'LOAD FAILED',
  },
}

export function FailurePage({
  failure,
  at,
}: {
  readonly failure: Failure
  /** When it failed, as the page first showed it. */
  readonly at: Date
}): ReactNode {
  const copy = COPY[failure.kind]
  const time = at.toISOString().replace('T', ' ').slice(0, 19)
  const Icon = failure.kind === 'sign-in' ? LogInIcon : RotateCcwIcon

  return (
    <PageState tone={copy.tone} data-failure={failure.kind}>
      <PageStateContent>
        <PageStateStatus label={copy.status}>{copy.protocol}</PageStateStatus>
        <PageStateCode>{copy.code}</PageStateCode>
        <PageStateHeader>
          {/* Focused when there is no way forward to focus, so a screen reader starts at what happened. */}
          <PageStateTitle tabIndex={-1} data-failure-title className="outline-none">
            {failure.title}
          </PageStateTitle>
          <PageStateDescription>{copy.description}</PageStateDescription>
        </PageStateHeader>
        {failure.onAction !== undefined && (
          <PageStateActions>
            <Button data-failure-action onPress={failure.onAction}>
              <Icon data-icon="inline-start" /> {failure.actionLabel ?? 'Try again'}
            </Button>
          </PageStateActions>
        )}
        <PageStateMeta>
          <PageStateMetaItem
            label="Reason"
            value={failure.detail}
            copyable
            className="max-w-full"
          />
          <PageStateMetaItem label="Page" value={window.location.pathname} />
          <PageStateMetaItem label="Time" value={`${time} UTC`} />
        </PageStateMeta>
      </PageStateContent>
      <PageStateFigure>
        <LogTrack seed={23} fadeFrom={copy.stopsAt}>
          <LogTrackMarker at={copy.stopsAt} label={copy.marker} />
        </LogTrack>
      </PageStateFigure>
    </PageState>
  )
}
