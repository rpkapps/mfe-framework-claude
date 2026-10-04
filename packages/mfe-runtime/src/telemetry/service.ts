/**
 * The mount-bound telemetry service handed to authors. The host keeps its `dispose()` on
 * the same object as a non-enumerable property, so anything that walks it still sees only
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

import { MountTelemetryRuntime, type TelemetryRuntimeOptions } from './runtime.ts'
import { MountTracer } from './tracer.ts'
import { createWorkflow, type MountWorkflow } from './workflow.ts'

/**
 * What the host holds; authors receive the same object typed as `MfeTelemetry`, without the
 * member below.
 */
export interface MountTelemetryHandle extends MfeTelemetry {
  /**
   * Leaves the open workflow runs, ending as abandoned each one no other mount is in, and closes
   * the mount to new records; repeated calls are harmless.
   */
  dispose(): void
}

export function createMountTelemetry(
  provider: TelemetryProvider,
  attribution: TelemetryAttribution,
  options: TelemetryRuntimeOptions = {},
): MountTelemetryHandle {
  const runtime = new MountTelemetryRuntime(provider, attribution, options)
  const tracer = new MountTracer(runtime)
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
    // Leaving ends the spans of a run nobody is left in as abandoned, before the gate closes, and
    // hands the rest to the runs other mounts are still in, which end them later.
    for (const byKey of workflows.values()) for (const workflow of byKey.values()) workflow.leave()
    tracer.dispose()
    runtime.markDisposed()
  }

  Object.defineProperty(handle, 'dispose', { value: dispose, enumerable: false })

  return Object.freeze(handle)
}
