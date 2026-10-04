/**
 * The client span and W3C `traceparent` for each request through the framework's fetch to a
 * declared API, so the backend's span is its child. Only the method and the host are recorded: a
 * raw URL can carry ids and query values, which never belong in telemetry.
 */

import {
  SpanKind,
  SpanStatusCode,
  type TelemetryAttribution,
  type TelemetryProvider,
} from '@company/mfe-core'

import { MountTelemetryRuntime, type TelemetryRuntimeOptions } from './runtime.ts'
import { MountTracer } from './tracer.ts'
import { formatTraceparent, parseTraceparent } from './traceparent.ts'

export interface RequestTrace {
  /** Sent in place of the caller's own, so the backend's span is a child of this one. */
  readonly traceparent: string
  /** Counts a second attempt, as after a 401 and a refreshed token. */
  resent(): void
  end(outcome: { readonly status: number } | { readonly error: unknown }): void
  /** The caller cancelled it, as a query does when its component unmounts: left, not failed. */
  abandon(): void
}

export interface RequestTracer {
  /**
   * Joins the trace a valid caller `traceparent` names, as from a workflow's `headers()`, and
   * starts a trace otherwise. `undefined` sends the request as the caller wrote it: their header
   * is not W3C, or the provider failed.
   */
  trace(method: string, url: URL, callerTraceparent: string | null): RequestTrace | undefined
}

function defaultPort(url: URL): number {
  if (url.port !== '') return Number(url.port)
  return url.protocol === 'https:' ? 443 : 80
}

/**
 * A container has no mount, so its requests get a runtime of their own, attributed to the
 * container and never disposed. The provider is contained as it is for a mount: one that throws
 * leaves the request untraced, never failed, and is reported through `onDiagnostic`.
 */
export function createRequestTracer(
  provider: TelemetryProvider,
  attribution: TelemetryAttribution,
  options: TelemetryRuntimeOptions = {},
): RequestTracer {
  const tracer = new MountTracer(new MountTelemetryRuntime(provider, attribution, options))

  return Object.freeze({
    trace(method: string, url: URL, callerTraceparent: string | null): RequestTrace | undefined {
      const parent = callerTraceparent === null ? undefined : parseTraceparent(callerTraceparent)
      if (callerTraceparent !== null && parent === undefined) return undefined

      const span = tracer.startSpan(method, {
        kind: SpanKind.CLIENT,
        parent,
        attributes: {
          'http.request.method': method,
          'server.address': url.hostname,
          'server.port': defaultPort(url),
        },
      })
      if (span === undefined) return undefined
      let resends = 0

      return {
        traceparent: formatTraceparent(span),
        resent(): void {
          resends += 1
          span.setAttributes({ 'http.request.resend_count': resends })
        },
        end(outcome): void {
          if ('status' in outcome) {
            span.setAttributes({ 'http.response.status_code': outcome.status })
            // A client span counts 4xx as an error too: the request did not do what was asked.
            if (outcome.status >= 400) span.setStatus(SpanStatusCode.ERROR)
          } else {
            span.recordException(outcome.error).setStatus(SpanStatusCode.ERROR)
          }
          span.end()
        },
        abandon(): void {
          span.endAbandoned()
        },
      }
    },
  })
}
