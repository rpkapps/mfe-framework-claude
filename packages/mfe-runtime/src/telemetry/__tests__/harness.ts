/** Shared fixtures for the telemetry tests: mounts bound to a recording provider. */

import type { Diagnostic, SpanRecord, TelemetryAttribution } from '@company/mfe-core'

import {
  createRecordingTelemetryProvider,
  type RecordingTelemetryProvider,
} from '../../testing/recording-provider.ts'
import type { TelemetryRuntimeOptions } from '../runtime.ts'
import { createMountTelemetry } from '../service.ts'

export const ATTRIBUTION: TelemetryAttribution = {
  definitionId: 'operations-console',
  definitionKind: 'app',
  definitionVersion: '2.4.1',
  buildHash: 'a1b2c3d4',
  mountToken: 'mount-7',
}

/** The entry at `index`, failing with the gap it found rather than `undefined`. */
export function at<T>(items: readonly T[], index = 0): T {
  const item = items[index]
  if (item === undefined) throw new Error(`expected an item at index ${index}`)
  return item
}

export function spanNamed(spans: readonly SpanRecord[], name: string): SpanRecord {
  const match = spans.find(span => span.name === name)
  if (match === undefined) throw new Error(`no span named ${name}`)
  return match
}

export function setup(
  options: TelemetryRuntimeOptions = {},
  attribution: TelemetryAttribution = ATTRIBUTION,
) {
  const provider = createRecordingTelemetryProvider()
  return { provider, ...mountOn(provider, attribution, options) }
}

/** Another mount on the same page, sending to `provider`; its diagnostics are its own. */
export function mountOn(
  provider: RecordingTelemetryProvider,
  attribution: TelemetryAttribution,
  options: TelemetryRuntimeOptions = {},
) {
  const diagnostics: Diagnostic[] = []
  const telemetry = createMountTelemetry(provider, attribution, {
    dev: true,
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    ...options,
  })
  return { diagnostics, telemetry }
}

/** A mount whose provider threw building its tracer, so its workflows start no spans. */
export function mountUntraced(
  provider: RecordingTelemetryProvider,
  attribution: TelemetryAttribution = ATTRIBUTION,
) {
  provider.failTracerCreation(true)
  try {
    return mountOn(provider, attribution)
  } finally {
    provider.failTracerCreation(false)
  }
}

/** Workflow runs are the page's, so a run a test leaves open would be joined by the next one. */
export function resetPageWorkflows(): void {
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('@company/mfe.workflows')]
}
