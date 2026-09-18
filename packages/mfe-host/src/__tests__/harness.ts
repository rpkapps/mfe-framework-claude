/** Fixtures shared by the host tests: diagnostics capture, deferreds, task flush. */

import { DiagnosticsHub, type Diagnostic } from '@company/mfe-core'

export interface RecordedDiagnostics {
  readonly hub: DiagnosticsHub
  readonly records: Diagnostic[]
}

export function recordingDiagnostics(): RecordedDiagnostics {
  const records: Diagnostic[] = []
  const hub = new DiagnosticsHub()
  hub.add(diagnostic => records.push(diagnostic))
  return { hub, records }
}

export interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

/** Lets already-queued microtasks and callbacks run under real timers. */
export function flush(): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, 0)
  })
}

/** The entry at `index`, failing with the gap it found rather than `undefined`. */
export function at<T>(items: readonly T[], index = 0): T {
  const item = items[index]
  if (item === undefined) throw new Error(`expected an item at index ${index}`)
  return item
}

export const codesOf = (records: readonly Diagnostic[]): readonly string[] =>
  records.map(record => record.error.code)
