/**
 * The client span and W3C `traceparent` for one request through the framework's fetch, so the
 * backend's span joins the trace of the click that sent it. Only the method and the host are
 * recorded: a raw URL can carry ids and query values, which never belong in telemetry.
 */

import { SpanKind, SpanStatusCode, type Span, type TelemetrySpanContext } from '@company/mfe-core'

import { getActiveSpanContext } from './active-span.ts'

export interface RequestTrace {
  /** Version 00 and the sampled flag: sampling is the shell's to decide downstream. */
  readonly traceparent: string
  /** Counts a second attempt, as after a 401 and a refreshed token. */
  resent(): void
  end(outcome: { readonly status: number } | { readonly error: unknown }): void
}

function idsOf(span: Span): TelemetrySpanContext | undefined {
  // Read structurally: the span may come from another copy of the runtime on the page (§55).
  const { traceId, spanId } = span as Partial<TelemetrySpanContext>
  return typeof traceId === 'string' && typeof spanId === 'string' ? { traceId, spanId } : undefined
}

function defaultPort(url: URL): number {
  if (url.port !== '') return Number(url.port)
  return url.protocol === 'https:' ? 443 : 80
}

/**
 * Reads the active span synchronously, so it is called before the request's first `await`;
 * outside any active span there is nothing to join and the request goes out untraced.
 */
export function traceRequest(method: string, url: URL): RequestTrace | undefined {
  const active = getActiveSpanContext()
  if (active === undefined) return undefined

  const span = active.tracer.startSpan(method, {
    kind: SpanKind.CLIENT,
    attributes: {
      'http.request.method': method,
      'server.address': url.hostname,
      'server.port': defaultPort(url),
    },
  })
  // A span that does not record still carries the request into the active span's trace.
  const { traceId, spanId } = idsOf(span) ?? active
  let resends = 0

  return {
    traceparent: `00-${traceId}-${spanId}-01`,
    resent(): void {
      resends += 1
      span.setAttribute('http.request.resend_count', resends)
    },
    end(outcome): void {
      if ('status' in outcome) {
        span.setAttribute('http.response.status_code', outcome.status)
        // A client span counts 4xx as an error too: the request did not do what was asked.
        if (outcome.status >= 400) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: String(outcome.status) })
        }
      } else {
        span.recordException(outcome.error)
        span.setStatus({ code: SpanStatusCode.ERROR })
      }
      span.end()
    },
  }
}
