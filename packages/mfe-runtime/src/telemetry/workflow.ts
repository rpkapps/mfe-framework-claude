/**
 * A named workflow: one trace with a root span for the workflow and a child span per step. Nothing
 * is ambient, so a request joins the trace only when its author spreads `headers()` into it, and
 * background requests never land in a workflow by accident.
 *
 * A run is the page's, not the mount's: every App and Widget that names a workflow reaches the same
 * run, so a cart and a payment Widget the shell places side by side trace one checkout (§59). Each
 * mount still has a `Workflow` of its own, which records through its own runtime and starts spans
 * on its own tracer, so every span and record says which mount made it.
 */

import {
  boundName,
  SpanStatusCode,
  type MeasurementUnit,
  type TelemetryAttributes,
  type TelemetrySpanContext,
  type Workflow,
} from '@company/mfe-core'

import { DEV } from '../dev.ts'
import { isReservedAttributeKey, type MountTelemetryRuntime } from './runtime.ts'
import type { MountSpan, MountTracer } from './tracer.ts'
import { formatTraceparent } from './traceparent.ts'

/**
 * The page's open runs live under a registered symbol rather than in this module, because a
 * container may run on a copy of the runtime other than the shell's (§55). What is kept there is a
 * contract between those copies, so it is plain data and plain functions: nothing is recognised by
 * its class, and a span is reached only through the functions the copy that started it put there.
 */
const PAGE_WORKFLOWS = Symbol.for('@company/mfe.workflows')

/** A mount taking part in a run, one per mount and run; told apart by identity. */
interface Participant {
  readonly definitionId: string
  readonly buildHash: string | undefined
}

/** A span as the page holds it; each function forwards to the span of the mount that started it. */
interface SharedSpan {
  readonly traceId: string
  readonly spanId: string
  /** Whose tracer started it, so that mount's disposal hands over only its own spans. */
  readonly owner: Participant
  setAttributes(attributes: TelemetryAttributes): void
  end(): void
  succeed(): void
  fail(error: unknown): void
  abandon(): void
  /** Takes it out of its mount's disposal, so the run can still end it once that mount is gone. */
  detach(): void
}

interface SharedRun {
  /** Absent when the mount that opened it had tracing off or its provider failed. */
  readonly root: SharedSpan | undefined
  /** Whoever marks the next step ends this one, whichever mount started it. */
  step: SharedSpan | undefined
  readonly participants: Set<Participant>
  /** The collision diagnostic is given once per run. */
  collisionReported: boolean
}

/** By name, then by key; a run is removed when it ends, so the page keeps only open ones. */
type PageWorkflows = Map<string, Map<string | undefined, SharedRun>>

interface PageWithWorkflows {
  [PAGE_WORKFLOWS]?: PageWorkflows
}

function pageWorkflows(): PageWorkflows {
  const page = globalThis as PageWithWorkflows
  let runs = page[PAGE_WORKFLOWS]
  if (runs === undefined) {
    runs = new Map()
    page[PAGE_WORKFLOWS] = runs
  }
  return runs
}

function contextOf(span: SharedSpan | undefined): TelemetrySpanContext | undefined {
  return span === undefined
    ? undefined
    : Object.freeze({ traceId: span.traceId, spanId: span.spanId })
}

/** The mount's workflow, and what the mount's disposal does with it. */
export interface MountWorkflow {
  readonly workflow: Workflow
  /** Leaves the open run, which ends as abandoned once no mount is left in it. */
  leave(): void
}

/**
 * Open is the page's: a run exists from the first `start()` to its end, whether or not it has
 * spans, which are missing when tracing is off or the provider failed, so `fail()` still reports
 * its error then. The key only picks the run: it may be an order id, so it is held as a map key
 * and a diagnostic says one was given but never what it was.
 */
export function createWorkflow(
  name: string,
  key: string | undefined,
  runtime: MountTelemetryRuntime,
  tracer: MountTracer,
): MountWorkflow {
  const label = `workflow "${boundName(name)}"${key === undefined ? '' : ' with a key'}`
  const self: Participant = Object.freeze({
    definitionId: runtime.attribution.definitionId,
    buildHash: runtime.attribution.buildHash,
  })

  function find(): SharedRun | undefined {
    return pageWorkflows().get(name)?.get(key)
  }

  /** Removed before its spans end, so nothing that runs while they end can reach it. */
  function close(run: SharedRun): void {
    const runs = pageWorkflows()
    const byKey = runs.get(name)
    if (byKey?.get(key) !== run) return
    byKey.delete(key)
    if (byKey.size === 0) runs.delete(name)
  }

  function share(span: MountSpan): SharedSpan {
    return Object.freeze({
      traceId: span.traceId,
      spanId: span.spanId,
      owner: self,
      setAttributes: (attributes: TelemetryAttributes): void => {
        span.setAttributes(attributes)
      },
      end: (): void => {
        span.end()
      },
      succeed: (): void => {
        span.setStatus(SpanStatusCode.OK).end()
      },
      fail: (error: unknown): void => {
        span.recordException(error).setStatus(SpanStatusCode.ERROR).end()
      },
      abandon: (): void => {
        span.endAbandoned()
      },
      detach: (): void => {
        span.detach()
      },
    })
  }

  /**
   * Clamped, and stripped of the reserved keys, by this mount's runtime, so a collision is
   * reported to the mount that made it even when the span is another mount's.
   */
  function authored(attributes: TelemetryAttributes, operation: string): TelemetryAttributes {
    const own: Record<string, string | number | boolean> = {}
    for (const [field, value] of Object.entries(runtime.mergeAttributes(attributes, operation))) {
      if (!isReservedAttributeKey(field)) own[field] = value
    }
    return Object.freeze(own)
  }

  /** Acting on a run takes part in it; a mount that is gone never comes back into one. */
  function join(run: SharedRun): void {
    if (runtime.disposed || run.participants.has(self)) return
    run.participants.add(self)
    if (DEV) reportCollision(run)
  }

  /**
   * One name used by two deployed bundles is more often a clash than a shared run, so the first
   * participant from another build is reported. Without a build hash nothing can be compared.
   */
  function reportCollision(run: SharedRun): void {
    if (run.collisionReported || self.buildHash === undefined) return
    const others = [...run.participants].filter(
      participant =>
        participant.buildHash !== undefined && participant.buildHash !== self.buildHash,
    )
    if (others.length === 0) return
    run.collisionReported = true
    const ids = [...new Set([...others.map(other => other.definitionId), self.definitionId])]
    const last = ids.pop() ?? self.definitionId
    // Two builds of one definition collide too, as when two versions of it are deployed.
    const named = ids.length === 0 ? `builds of ${last}` : `${ids.join(', ')} and ${last}`
    runtime.diagnose({
      code: 'config/invalid',
      operation: `join ${label}`,
      expected: `${label} to be used by one deployed bundle, or shared on purpose`,
      observed: `a run shared by separately built ${named}`,
      repair:
        'Prefix the name with its domain, such as "orders.checkout", unless the run is meant to be shared. The run is still shared.',
    })
  }

  /** The open run when the call goes ahead: the mount is live and the run is open. */
  function accepted(operation: string): SharedRun | undefined {
    if (runtime.refused(operation)) return undefined
    const run = find()
    if (run !== undefined) {
      join(run)
      return run
    }
    if (DEV) {
      runtime.diagnose({
        code: 'config/invalid',
        operation,
        expected: `${label} to be started with start()`,
        observed: `${label}, which was not open`,
        repair: 'Call start() before its steps and its end. The call was ignored.',
      })
    }
    return undefined
  }

  /** The record's link: the current step, else the workflow; none while closed or untraced. */
  function linked(): TelemetrySpanContext | undefined {
    const run = find()
    if (run === undefined) return undefined
    join(run)
    return contextOf(run.step ?? run.root)
  }

  const workflow: Workflow = Object.freeze({
    start(attributes?: TelemetryAttributes): void {
      const operation = `start ${label}`
      if (runtime.refused(operation)) return
      const open = find()
      // Joining rather than restarting, so it does not matter which mount starts first.
      if (open !== undefined) {
        join(open)
        if (attributes !== undefined) open.root?.setAttributes(authored(attributes, operation))
        return
      }
      const root = tracer.startSpan(name, { attributes })
      const run: SharedRun = {
        root: root === undefined ? undefined : share(root),
        step: undefined,
        participants: new Set([self]),
        collisionReported: false,
      }
      const runs = pageWorkflows()
      let byKey = runs.get(name)
      if (byKey === undefined) {
        byKey = new Map()
        runs.set(name, byKey)
      }
      byKey.set(key, run)
    },

    step(stepName: string, attributes?: TelemetryAttributes): void {
      const run = accepted(`mark step "${boundName(stepName)}" of ${label}`)
      if (run === undefined) return
      run.step?.end()
      // Without the workflow's span a step would start a trace of its own, which is worse than none.
      const step =
        run.root === undefined
          ? undefined
          : tracer.startSpan(stepName, { attributes, parent: run.root })
      run.step = step === undefined ? undefined : share(step)
    },

    headers(): Record<string, string> {
      if (runtime.disposed) return {}
      const run = find()
      if (run === undefined) return {}
      join(run)
      const current = run.step ?? run.root
      return current === undefined ? {} : { traceparent: formatTraceparent(current) }
    },

    succeed(attributes?: TelemetryAttributes): void {
      const operation = `end ${label} as succeeded`
      const run = accepted(operation)
      if (run === undefined) return
      close(run)
      run.step?.end()
      if (attributes !== undefined) run.root?.setAttributes(authored(attributes, operation))
      run.root?.succeed()
    },

    fail(error: unknown, attributes?: TelemetryAttributes): void {
      const operation = `end ${label} as failed`
      const run = accepted(operation)
      // An error is never lost for want of a start(): it is still reported, just not on a trace.
      if (run === undefined) {
        if (!runtime.disposed) runtime.emitError(error, attributes)
        return
      }
      close(run)
      run.step?.fail(error)
      if (attributes !== undefined) run.root?.setAttributes(authored(attributes, operation))
      run.root?.fail(error)
      runtime.emitError(error, attributes, contextOf(run.root))
    },

    // Records are never refused for a closed workflow: a log must not be lost to a missing start().
    event(eventName: string, attributes?: TelemetryAttributes): void {
      runtime.emitEvent(eventName, attributes, linked())
    },

    debug(message: string, attributes?: TelemetryAttributes): void {
      runtime.emitLog('debug', message, attributes, undefined, linked())
    },

    info(message: string, attributes?: TelemetryAttributes): void {
      runtime.emitLog('info', message, attributes, undefined, linked())
    },

    warn(message: string, attributes?: TelemetryAttributes): void {
      runtime.emitLog('warn', message, attributes, undefined, linked())
    },

    error(error: unknown, attributes?: TelemetryAttributes): void {
      runtime.emitError(error, attributes, linked())
    },

    measure(
      measurementName: string,
      value: number,
      measurement: { unit: MeasurementUnit; attributes?: TelemetryAttributes },
    ): void {
      runtime.emitMeasurement(
        measurementName,
        value,
        measurement.unit,
        measurement.attributes,
        linked(),
      )
    },
  })

  return Object.freeze({
    workflow,
    leave(): void {
      const run = find()
      if (run === undefined || !run.participants.delete(self)) return
      if (run.participants.size === 0) {
        close(run)
        run.step?.abandon()
        run.root?.abandon()
        return
      }
      // The run outlives this mount, so the spans it started for the run are the run's to end.
      for (const span of [run.root, run.step]) if (span?.owner === self) span.detach()
    },
  })
}
