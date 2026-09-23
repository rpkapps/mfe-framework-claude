/** Shared fixtures for the telemetry tests: one mount bound to a recording provider. */

import type { Diagnostic, SpanRecord, TelemetryAttribution } from '@company/mfe-core'

import { createRecordingTelemetryProvider } from '../../testing/recording-provider.ts'
import { createMountTelemetry, type MountTelemetryOptions } from '../service.ts'

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
  options: MountTelemetryOptions = {},
  attribution: TelemetryAttribution = ATTRIBUTION,
) {
  const provider = createRecordingTelemetryProvider()
  const diagnostics: Diagnostic[] = []
  const telemetry = createMountTelemetry(provider, attribution, {
    dev: true,
    onDiagnostic: diagnostic => diagnostics.push(diagnostic),
    ...options,
  })
  return { provider, diagnostics, telemetry, tracer: telemetry.tracer }
}
