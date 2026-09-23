/** The one place a vendor telemetry SDK appears: this translates and nothing more, because redaction, sampling and delivery are Faro's. */

import type {
  SpanRecord,
  TelemetryAttributes,
  TelemetryAttribution,
  TelemetryLevel,
  TelemetryProvider,
  TelemetryRecord,
  Tracer,
} from '@company/mfe-react/host'
import { initializeFaro, LogLevel, type Faro } from '@grafana/faro-web-sdk'

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

export interface FaroProviderOptions {
  readonly faro: Faro
  /** The framework's span implementation, passed in so the repository has exactly one of them. */
  readonly createTracer: (
    attribution: TelemetryAttribution,
    onSpanEnd: (span: SpanRecord) => void,
  ) => Tracer
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
          api.pushEvent(record.name, toContext(record.attributes, record.attribution))
          return

        case 'measurement':
          api.pushMeasurement(
            { type: record.name, values: { [record.unit]: record.value } },
            { context: toContext(record.attributes, record.attribution) },
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
            api.pushError(asError(record.error), { context })
            return
          }
          api.pushLog([record.message], { level: LEVELS[record.level], context })
          return
        }
      }
    },

    createTracer(attribution: TelemetryAttribution): Tracer {
      return createTracer(attribution, span => {
        // Without Faro's OTel integration a completed span still reaches the backend as an
        // event rather than being silently dropped.
        api.pushEvent(
          `span.${span.name}`,
          toContext(span.attributes, span.attribution, {
            durationMs:
              span.endTime === undefined ? undefined : String(span.endTime - span.startTime),
            status: String(span.status.code),
            ...(span.status.message === undefined ? {} : { statusMessage: span.status.message }),
          }),
        )
        for (const exception of span.exceptions) {
          api.pushError(asError(exception), {
            context: toContext(span.attributes, span.attribution, { span: span.name }),
          })
        }
      })
    },
  }
}

/** Initializes Faro and adapts it, so `@grafana/faro-web-sdk` is named in this file and nowhere else in the shell. */
export function createFaroProvider(
  url: string,
  createTracer: FaroProviderOptions['createTracer'],
): TelemetryProvider {
  return createFaroTelemetryProvider({
    faro: initializeFaro({ url, app: { name: 'shell' } }),
    createTracer,
  })
}
