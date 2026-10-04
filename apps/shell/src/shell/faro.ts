/** The one place a vendor telemetry SDK appears: this translates and nothing more, because redaction, sampling and delivery are Faro's. */

import type {
  SpanRecord,
  TelemetryAttributes,
  TelemetryAttribution,
  TelemetryLevel,
  TelemetryProvider,
  TelemetryRecord,
  TelemetrySpanContext,
} from '@company/mfe-react/host'
import { initializeFaro, LogLevel, type Faro } from '@grafana/faro-web-sdk'

type ProviderTracer = ReturnType<TelemetryProvider['createTracer']>

/** Faro's context is string-valued, so scalars are rendered, never dropped. */
function toContext(
  attributes: TelemetryAttributes,
  attribution: TelemetryAttribution,
  extra: Readonly<Record<string, string | undefined>> = {},
): Record<string, string> {
  const context: Record<string, string> = {
    definitionId: attribution.definitionId,
    definitionKind: attribution.definitionKind,
  }
  if (attribution.definitionVersion !== undefined)
    context['definitionVersion'] = attribution.definitionVersion
  if (attribution.buildHash !== undefined) context['buildHash'] = attribution.buildHash
  if (attribution.mountToken !== undefined) context['mountToken'] = attribution.mountToken
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) context[key] = value
  }
  // Attribution wins: an author attribute can never overwrite it.
  for (const [key, value] of Object.entries(attributes)) {
    if (!(key in context)) context[key] = String(value)
  }
  return context
}

const LEVELS: Record<TelemetryLevel, LogLevel> = {
  debug: LogLevel.DEBUG,
  info: LogLevel.INFO,
  warn: LogLevel.WARN,
  error: LogLevel.ERROR,
}

function asError(value: unknown): Error {
  if (value instanceof Error) return value
  return new Error(typeof value === 'string' ? value : JSON.stringify(value))
}

/** Faro's option shape, present only when the record was made inside a span. */
function linked(spanContext: TelemetrySpanContext | undefined): {
  spanContext?: TelemetrySpanContext
} {
  return spanContext === undefined ? {} : { spanContext }
}

type TraceEvent = Parameters<Faro['api']['pushTraces']>[0]
type OtlpResourceSpans = NonNullable<TraceEvent['resourceSpans']>[number]
type OtlpSpan = NonNullable<OtlpResourceSpans['scopeSpans'][number]['spans']>[number]
type OtlpKeyValue = OtlpSpan['attributes'][number]

function otlpAttributes(attributes: TelemetryAttributes): OtlpKeyValue[] {
  return Object.entries(attributes).map(([key, value]) => ({
    key,
    value:
      typeof value === 'string'
        ? { stringValue: value }
        : typeof value === 'boolean'
          ? { boolValue: value }
          : Number.isInteger(value)
            ? { intValue: value }
            : { doubleValue: value },
  }))
}

/** Epoch milliseconds as OTLP nanoseconds, as a string: the number would lose precision. */
function nanos(milliseconds: number): string {
  return (BigInt(Math.round(milliseconds)) * 1_000_000n).toString()
}

/**
 * One finished span as OTLP, with the framework's own ids, so a backend span that received this
 * span's `traceparent` lands in the same trace. Faro's span processor would add the session and
 * user to each span; spans built here get them the same way.
 */
function toOtlp(span: SpanRecord, spanContext: TelemetrySpanContext, faro: Faro): TraceEvent {
  const { app, session, user } = faro.metas.value
  const meta: Record<string, string> = {}
  if (session?.id !== undefined) meta['session.id'] = session.id
  if (user?.id !== undefined) meta['user.id'] = user.id

  const resource: Record<string, string> = { 'service.name': app?.name ?? 'unknown' }
  if (app?.version !== undefined) resource['service.version'] = app.version

  const otlp: OtlpSpan = {
    traceId: spanContext.traceId,
    spanId: spanContext.spanId,
    ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
    name: span.name,
    // OTLP numbers its kinds from 1, the OpenTelemetry API from 0.
    kind: span.kind + 1,
    startTimeUnixNano: nanos(span.startTime),
    endTimeUnixNano: nanos(span.endTime ?? span.startTime),
    attributes: otlpAttributes({ ...span.attributes, ...meta }),
    droppedAttributesCount: 0,
    events: span.events.map(event => ({
      timeUnixNano: nanos(event.timestamp),
      name: event.name,
      attributes: otlpAttributes(event.attributes),
      droppedAttributesCount: 0,
    })),
    droppedEventsCount: 0,
    links: [],
    droppedLinksCount: 0,
    status: {
      code: span.status.code,
      ...(span.status.message === undefined ? {} : { message: span.status.message }),
    },
  }

  return {
    resourceSpans: [
      {
        resource: { attributes: otlpAttributes(resource), droppedAttributesCount: 0 },
        scopeSpans: [{ scope: { name: '@company/mfe-runtime' }, spans: [otlp] }],
      },
    ],
  }
}

export interface FaroProviderOptions {
  readonly faro: Faro
  /** The framework's span implementation, passed in so the repository has exactly one of them. */
  readonly createTracer: (
    attribution: TelemetryAttribution,
    onSpanEnd: (span: SpanRecord) => void,
  ) => ProviderTracer
}

export function createFaroTelemetryProvider({
  faro,
  createTracer,
}: FaroProviderOptions): TelemetryProvider {
  const { api } = faro

  return {
    record(record: TelemetryRecord): void {
      switch (record.kind) {
        case 'event':
          api.pushEvent(
            record.name,
            toContext(record.attributes, record.attribution),
            undefined,
            linked(record.spanContext),
          )
          return

        case 'measurement':
          api.pushMeasurement(
            { type: record.name, values: { [record.unit]: record.value } },
            {
              context: toContext(record.attributes, record.attribution),
              ...linked(record.spanContext),
            },
          )
          return

        case 'log':
        case 'framework': {
          // A framework diagnostic stays distinguishable from author telemetry.
          const context = toContext(record.attributes, record.attribution, {
            recordKind: record.kind,
            ...(record.kind === 'framework' ? { operation: record.operation } : {}),
          })
          if (record.error !== undefined) {
            api.pushError(asError(record.error), { context, ...linked(record.spanContext) })
            return
          }
          api.pushLog([record.message], {
            level: LEVELS[record.level],
            context,
            ...linked(record.spanContext),
          })
          return
        }
      }
    },

    createTracer(attribution: TelemetryAttribution): ProviderTracer {
      return createTracer(attribution, span => {
        // A span started outside a mount's tracer has no ids, so it cannot join a trace.
        const { spanContext } = span
        if (spanContext !== undefined) api.pushTraces(toOtlp(span, spanContext, faro))
        for (const exception of span.exceptions) {
          api.pushError(asError(exception), {
            context: toContext(span.attributes, span.attribution, { span: span.name }),
            ...linked(spanContext),
          })
        }
      })
    },
  }
}

/** What the shell tells telemetry beyond the MFEs' own records: who is signed in, and where. */
export interface ShellTelemetry {
  readonly provider: TelemetryProvider
  /** Only the id: a name or an email is personal data the backend does not need. */
  setUser(user: { readonly id: string } | null): void
  /** A short, stable name such as the App on screen, never a URL. */
  setView(name: string): void
}

/** Initializes Faro and adapts it, so `@grafana/faro-web-sdk` is named in this file and nowhere else in the shell. */
export function createFaroTelemetry(
  url: string,
  createTracer: FaroProviderOptions['createTracer'],
): ShellTelemetry {
  const faro = initializeFaro({ url, app: { name: 'shell' } })
  return {
    provider: createFaroTelemetryProvider({ faro, createTracer }),
    setUser: user => {
      if (user === null) faro.api.resetUser()
      else faro.api.setUser({ id: user.id })
    },
    // Faro ignores a repeat of the current view, so every navigation can call this.
    setView: name => faro.api.setView({ name }),
  }
}
