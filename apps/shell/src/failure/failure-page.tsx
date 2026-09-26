/**
 * Why the workspace did not open, in Tecton's page-state block (`src/blocks/page-state`, installed
 * from the `@tecton` registry): the status and code, what happened and the one way forward, the
 * reason as the identity provider or the browser gave it, and the well log that stops where the
 * load did. It replaces the loading screen when sign-in, the configuration or the boot fails
 * (`loader.ts`), so it is the first React the page renders, and nothing behind sign-in is in it.
 *
 * Nothing here may import React Aria: it is shared across the federation, so it is never
 * tree-shaken, and one Tecton `Button` would add its whole library (about 265 kB gzipped) to a page
 * that has one button. The action and the reason's copy button are native buttons with Tecton's
 * button classes (`button-classes.ts`), and the block's meta item, which copies through Tecton's
 * `CopyButton`, is rendered here rather than imported; the block's other parts carry no React
 * Aria, and the build drops the `CopyButton` import with the part that uses it.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from 'cn'
import { CheckIcon, CopyIcon, LogInIcon, RotateCcwIcon } from 'lucide-react'

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
  PageStateStatus,
  PageStateTitle,
  type PageStateTone,
} from '../blocks/page-state/components/page-state'
import { ACTION_BUTTON, COPY_BUTTON } from './button-classes.ts'

/** What failed, which decides the status, the code and what the page says to do. */
export type FailureKind = 'sign-in' | 'unreachable' | 'configuration' | 'workspace'

export interface Failure {
  readonly kind: FailureKind
  readonly title: string
  /** The reason as it was given, shown as it is: the one thing support will ask for. */
  readonly detail: string
  readonly actionLabel?: string
  /** What the action says once pressed, while the page is on its way: `Redirecting…`. */
  readonly pendingLabel?: string
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
      'This deployment’s settings could not be read or are incomplete, so the workspace cannot start. Send the reason below to whoever runs this deployment.',
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

/**
 * The way forward. Pressed once, it says where the page is going and takes no second press; it
 * stays focusable, so a screen reader that is on it hears that. A later failure renders a fresh
 * page, and with it a button that can be pressed again.
 */
function FailureAction({ failure }: { readonly failure: Failure }): ReactNode {
  const [pending, setPending] = useState(false)
  // Read by a second press that arrives before the first one's render.
  const pressed = useRef(false)
  const { onAction } = failure
  if (onAction === undefined) return null
  const Icon = failure.kind === 'sign-in' ? LogInIcon : RotateCcwIcon
  return (
    <PageStateActions>
      <button
        type="button"
        data-failure-action
        data-slot="button"
        aria-disabled={pending || undefined}
        aria-busy={pending || undefined}
        className={cn(ACTION_BUTTON, 'aria-disabled:cursor-progress aria-disabled:opacity-50')}
        onClick={() => {
          if (pressed.current) return
          pressed.current = true
          setPending(true)
          onAction()
        }}
      >
        <Icon data-icon="inline-start" />{' '}
        {pending
          ? (failure.pendingLabel ?? failure.actionLabel ?? 'Try again')
          : (failure.actionLabel ?? 'Try again')}
      </button>
    </PageStateActions>
  )
}

/** The block's meta item, with a native copy button in place of Tecton's (see above). */
function MetaItem({
  label,
  value,
  copyable = false,
  className,
}: {
  readonly label: string
  readonly value: string
  readonly copyable?: boolean
  readonly className?: string
}): ReactNode {
  return (
    <div
      data-slot="page-state-meta-item"
      className={cn('flex min-w-0 flex-col gap-0.5', className)}
    >
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex items-center gap-1 font-mono text-foreground">
        <span className="truncate">{value}</span>
        {copyable && <CopyValue label={label} value={value} />}
      </dd>
    </div>
  )
}

/** A tick for two seconds once copied, as `CopyButton` shows; a refused clipboard changes nothing. */
function CopyValue({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}): ReactNode {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number>(undefined)
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
    },
    [],
  )
  return (
    <button
      type="button"
      data-slot="copy-button"
      data-copied={copied || undefined}
      aria-label={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
      className={cn(COPY_BUTTON, '-my-1 text-muted-foreground data-copied:text-success')}
      onClick={() => {
        void (async () => {
          try {
            // Missing outside a secure context, where the call itself throws.
            await navigator.clipboard.writeText(value)
          } catch {
            return
          }
          setCopied(true)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => {
            setCopied(false)
          }, 2000)
        })()
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
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
        <FailureAction failure={failure} />
        <PageStateMeta>
          <MetaItem label="Reason" value={failure.detail} copyable className="max-w-full" />
          <MetaItem label="Page" value={window.location.pathname} />
          <MetaItem label="Time" value={`${time} UTC`} />
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
