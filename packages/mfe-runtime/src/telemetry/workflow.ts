/**
 * A named workflow: one trace with a root span for the workflow and a child span per step. Nothing
 * is ambient, so a request joins the trace only when its author spreads `headers()` into it, and
 * background requests never land in a workflow by accident.
 */

import {
  boundName,
  SpanStatusCode,
  type TelemetryAttributes,
  type TelemetrySpanContext,
  type Workflow,
} from '@company/mfe-core'

import { DEV } from '../dev.ts'
import type { MountTelemetryRuntime } from './runtime.ts'
import type { MountSpan, MountTracer } from './tracer.ts'

/** W3C `traceparent`, version 00 with the sampled flag: sampling is the shell's to decide downstream. */
function traceparentOf(span: MountSpan): string {
  return `00-${span.traceId}-${span.spanId}-01`
}

/**
 * Open is tracked apart from the spans, which are missing when tracing is off or the provider
 * failed, so `fail()` still reports its error then.
 */
export function createWorkflow(
  name: string,
  runtime: MountTelemetryRuntime,
  tracer: MountTracer,
): Workflow {
  const label = `workflow "${boundName(name)}"`
  let open = false
  let root: MountSpan | undefined
  let step: MountSpan | undefined

  /** True when the call goes ahead: the mount is live and the workflow is open. */
  function accepts(operation: string): boolean {
    if (runtime.refused(operation)) return false
    if (open) return true
    if (DEV) {
      runtime.diagnose({
        code: 'config/invalid',
        operation,
        expected: `${label} to be started with start()`,
        observed: `${label}, which was not open`,
        repair: 'Call start() before its steps and its end. The call was ignored.',
      })
    }
    return false
  }

  function close(): void {
    open = false
    root = undefined
    step = undefined
  }

  return Object.freeze({
    start(attributes?: TelemetryAttributes): void {
      if (runtime.refused(`start ${label}`)) return
      if (open) {
        step?.endAbandoned()
        root?.endAbandoned()
      }
      open = true
      root = tracer.startSpan(name, { attributes })
      step = undefined
    },

    step(stepName: string, attributes?: TelemetryAttributes): void {
      if (!accepts(`mark step "${boundName(stepName)}" of ${label}`)) return
      step?.end()
      // Without the workflow's span a step would start a trace of its own, which is worse than none.
      step =
        root === undefined ? undefined : tracer.startSpan(stepName, { attributes, parent: root })
    },

    headers(): Record<string, string> {
      if (!open || runtime.disposed) return {}
      const current = step ?? root
      return current === undefined ? {} : { traceparent: traceparentOf(current) }
    },

    succeed(attributes?: TelemetryAttributes): void {
      if (!accepts(`end ${label} as succeeded`)) return
      step?.end()
      if (attributes !== undefined) root?.setAttributes(attributes)
      root?.setStatus(SpanStatusCode.OK).end()
      close()
    },

    fail(error: unknown, attributes?: TelemetryAttributes): void {
      // An error is never lost for want of a start(): it is still reported, just not on a trace.
      if (!accepts(`end ${label} as failed`)) {
        if (!runtime.disposed) runtime.emitError(error, attributes)
        return
      }
      step?.recordException(error).setStatus(SpanStatusCode.ERROR).end()
      if (attributes !== undefined) root?.setAttributes(attributes)
      root?.recordException(error).setStatus(SpanStatusCode.ERROR).end()
      const spanContext: TelemetrySpanContext | undefined =
        root === undefined
          ? undefined
          : Object.freeze({ traceId: root.traceId, spanId: root.spanId })
      close()
      runtime.emitError(error, attributes, spanContext)
    },
  })
}
