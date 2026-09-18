/**
 * `createMountTelemetry` — the mount-bound telemetry service handed to authors.
 *
 * The author surface is exactly seven imperative members. The host keeps its
 * own controls on the same object as non-enumerable properties, so anything
 * that walks the object still sees only those seven. Every member is created
 * once and frozen, so it can be closed over without re-running an effect.
 */

import type {
  MeasurementUnit,
  MfeTelemetry,
  TelemetryAttributes,
  TelemetryAttribution,
  TelemetryLevel,
  TelemetryProvider,
} from '@company/mfe-core'

import {
  MountTelemetryRuntime,
  type TelemetryCounters,
  type TelemetryRuntimeOptions,
} from './runtime.ts'
import { MountTracer } from './tracer.ts'

export interface MountTelemetryOptions extends TelemetryRuntimeOptions {
  /** False switches tracing off: every span is a non-recording handle. Defaults to true. */
  readonly tracing?: boolean
}

export interface FrameworkRecordDetails {
  /** Defaults to `info`. */
  readonly level?: TelemetryLevel
  readonly message: string
  readonly error?: unknown
  readonly attributes?: TelemetryAttributes
}

/**
 * What the host holds. Authors receive the same object typed as `MfeTelemetry`;
 * the members below are host-owned and are not part of the author surface.
 */
export interface MountTelemetryHandle extends MfeTelemetry {
  readonly attribution: TelemetryAttribution
  readonly disposed: boolean
  /** A frozen snapshot of the local drop, failure and diagnostic counters. */
  readonly counters: TelemetryCounters
  readonly openSpanCount: number
  /** Framework lifecycle diagnostics, deduplicated against reported errors. */
  framework(operation: string, details: FrameworkRecordDetails): void
  /**
   * Finalizes outstanding spans as cancelled and closes the mount to new
   * records. Repeated calls are harmless.
   */
  dispose(): void
}

export function createMountTelemetry(
  provider: TelemetryProvider,
  attribution: TelemetryAttribution,
  options: MountTelemetryOptions = {},
): MountTelemetryHandle {
  const runtime = new MountTelemetryRuntime(provider, attribution, options)
  const tracer = new MountTracer(runtime, { enabled: options.tracing ?? true })

  const surface: MfeTelemetry = {
    event(name: string, attributes?: TelemetryAttributes): void {
      runtime.emitEvent(name, attributes)
    },
    debug(message: string, attributes?: TelemetryAttributes): void {
      runtime.emitLog('debug', message, attributes)
    },
    info(message: string, attributes?: TelemetryAttributes): void {
      runtime.emitLog('info', message, attributes)
    },
    warn(message: string, attributes?: TelemetryAttributes): void {
      runtime.emitLog('warn', message, attributes)
    },
    error(error: unknown, attributes?: TelemetryAttributes): void {
      runtime.emitError(error, attributes)
    },
    measure(
      name: string,
      value: number,
      measurement: { unit: MeasurementUnit; attributes?: TelemetryAttributes },
    ): void {
      runtime.emitMeasurement(name, value, measurement.unit, measurement.attributes)
    },
    tracer,
  }

  const handle = surface as MountTelemetryHandle

  function dispose(): void {
    if (runtime.disposed) return
    // Teardown finalization runs before the gate closes: it is the one thing
    // allowed to touch the provider after disposal was requested.
    const leaked = tracer.finalizeOpenSpans()
    if (leaked.finalized > 0) {
      const names = leaked.names.slice(0, 8).join(', ')
      runtime.diagnose({
        code: 'dispose/failure',
        operation: 'dispose the mount telemetry',
        expected: 'every span started by the mount to be ended by its author',
        observed: `${leaked.finalized} span(s) still open: ${names}`,
        repair:
          'End each span in a finally block. They were closed as cancelled, not as failures, so no alert fires.',
        context: { openSpans: leaked.finalized, spanNames: names },
      })
    }
    runtime.markDisposed()
  }

  Object.defineProperties(handle, {
    attribution: { value: runtime.attribution, enumerable: false },
    disposed: { get: (): boolean => runtime.disposed, enumerable: false },
    counters: { get: (): TelemetryCounters => runtime.counterSnapshot(), enumerable: false },
    openSpanCount: { get: (): number => tracer.openSpanCount, enumerable: false },
    framework: {
      value: (operation: string, details: FrameworkRecordDetails): void => {
        runtime.emitFramework(operation, details)
      },
      enumerable: false,
    },
    dispose: { value: dispose, enumerable: false },
  })

  return Object.freeze(handle)
}
