/**
 * The mount-bound telemetry service handed to authors. The host keeps its own controls on
 * the same object as non-enumerable properties, so anything that walks it still sees only
 * the author surface, and every member is frozen so it can be closed over safely.
 */

import type {
  MeasurementUnit,
  MfeTelemetry,
  TelemetryAttributes,
  TelemetryAttribution,
  TelemetryProvider,
  Workflow,
} from '@company/mfe-core'

import {
  MountTelemetryRuntime,
  type FrameworkRecordDetails,
  type TelemetryCounters,
  type TelemetryRuntimeOptions,
} from './runtime.ts'
import { MountTracer } from './tracer.ts'
import { createWorkflow, type MountWorkflow } from './workflow.ts'

export interface MountTelemetryOptions extends TelemetryRuntimeOptions {
  /** False switches tracing off, so workflows start no spans and send no headers; defaults to true. */
  readonly tracing?: boolean
}

/**
 * What the host holds; authors receive the same object typed as `MfeTelemetry`, without the
 * members below.
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
   * Leaves the open workflow runs, ending as abandoned each one no other mount is in, and closes
   * the mount to new records; repeated calls are harmless.
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
  // One per name and key, held for the mount's life; the run behind each is the page's.
  const workflows = new Map<string, Map<string | undefined, MountWorkflow>>()

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
    workflow(name: string, key?: string): Workflow {
      let byKey = workflows.get(name)
      if (byKey === undefined) {
        byKey = new Map()
        workflows.set(name, byKey)
      }
      let workflow = byKey.get(key)
      if (workflow === undefined) {
        workflow = createWorkflow(name, key, runtime, tracer)
        byKey.set(key, workflow)
      }
      return workflow.workflow
    },
  }

  const handle = surface as MountTelemetryHandle

  function dispose(): void {
    if (runtime.disposed) return
    // Leaving first: a run another mount is still in keeps the spans this one started for it, and
    // a run nobody is left in ends as abandoned before finalization could cancel its spans.
    for (const byKey of workflows.values()) for (const workflow of byKey.values()) workflow.leave()
    // Teardown finalization runs before the gate closes: besides a span handed over to a run
    // above, which the run ends later, it is the one thing allowed to touch the provider after
    // disposal was requested.
    tracer.finalizeOpenSpans()
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
