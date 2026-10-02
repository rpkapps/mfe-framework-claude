// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createWidget } from '@company/mfe-react'
import { mountDefinition } from '@company/mfe-react/host'
import { reactAdapter } from '@company/mfe-react/registry'
import { createMemoryRuntime, mountWidget, type MemoryRuntime } from '@company/mfe-react/testing'

import { collectDiagnostics, formatReport } from './diagnostics.ts'

const widget = createWidget({
  id: 'counter-widget',
  version: '1.4.0',
  inputSchema: z.object({ privateNote: z.string() }),
  outputSchema: z.object({}),
  render: () => null,
})

const memories: MemoryRuntime[] = []
const disposals: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose()
  for (const result of memories.splice(0)) result.dispose()
  vi.restoreAllMocks()
  window.history.replaceState(null, '', '/')
})

function memory(options: Parameters<typeof createMemoryRuntime>[0] = {}): MemoryRuntime {
  const result = createMemoryRuntime(options)
  memories.push(result)
  return result
}

describe('the shell bug report', () => {
  it('reports actual duplicate Widgets, keeps the captured report, and omits their inputs', async () => {
    window.history.replaceState(null, '', '/looks-like-an-app')
    const shared = memory({ definitions: [widget] })
    const { runtime } = shared
    const first = await mountWidget(widget, {
      memory: shared,
      inputs: { privateNote: 'private input from the first Widget' },
    })
    const second = await mountWidget(widget, {
      memory: shared,
      inputs: { privateNote: 'private input from the second Widget' },
    })
    disposals.push(first.dispose, second.dispose)
    const readSnapshot = vi.spyOn(runtime, 'getSnapshot')

    const captured = collectDiagnostics(runtime)
    const report = formatReport('Widget failure', 'Steps to reproduce.', captured)

    expect(readSnapshot).toHaveBeenCalledOnce()
    expect(captured.mounted).toBe(
      'counter-widget (widget, mounted), counter-widget (widget, mounted)',
    )
    expect(new Set(captured.runtimeSnapshot.mounts.map(mount => mount.mountId)).size).toBe(2)
    expect(captured.runtimeSnapshot.mounts).toEqual([
      expect.objectContaining({ definitionId: 'counter-widget', version: '1.4.0' }),
      expect.objectContaining({ definitionId: 'counter-widget', version: '1.4.0' }),
    ])
    expect(report).not.toContain('private input')
    expect(report).toContain('Steps to reproduce.')
    expect(report).toContain('## Runtime snapshot\n\n```json\n')
    expect(report).toContain(JSON.stringify(captured.runtimeSnapshot, null, 2))

    await first.dispose()
    expect(collectDiagnostics(runtime).runtimeSnapshot.mounts).toHaveLength(1)
    expect(formatReport('Widget failure', 'Steps to reproduce.', captured)).toBe(report)
  })

  it('includes pending and failed placements, then removes them after disposal', async () => {
    const { runtime } = memory()
    const mount = mountDefinition({
      runtime,
      element: document.createElement('div'),
      definitionId: 'missing-widget',
      kind: 'widget',
      inputs: {},
    })
    disposals.push(() => mount.dispose())

    expect(collectDiagnostics(runtime).mounted).toBe('missing-widget (widget, pending)')
    await vi.waitFor(() => {
      expect(mount.state.status).toBe('error')
    })
    const failed = collectDiagnostics(runtime)
    expect(failed.mounted).toBe('missing-widget (widget, error)')
    expect(failed.runtimeSnapshot.mounts).toEqual([
      expect.objectContaining({ status: 'error', errorCode: 'registry/invalid-entry' }),
    ])
    expect(formatReport('', '', failed)).toContain('"errorCode": "registry/invalid-entry"')

    await mount.dispose()
    expect(collectDiagnostics(runtime).mounted).toBe('none')
  })

  it('uses one capture for registry builds, rejection codes and the report time', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-02T03:00:00Z'))
    const { runtime } = memory({
      adapters: [reactAdapter],
      registryEntries: [
        {
          id: 'reports',
          kind: 'app',
          mfe: { framework: 'react' },
          manifestUrl: 'https://cdn.example.test/reports/mf-manifest.json',
          requiresRuntime: '>=1.2.0 <2.0.0',
          container: 'example_reports',
          build: { hash: 'abc123', time: '2026-10-01T12:00:00Z' },
        },
        { id: 'stray', requiresRuntime: '>=1.2.0 <2.0.0' },
      ],
    })

    const diagnostics = collectDiagnostics(runtime)
    const report = formatReport('', '', diagnostics)

    expect(diagnostics.registryLoaded).toBe(1)
    expect(diagnostics.builds).toEqual(['reports: abc123 · 2026-10-01T12:00:00Z'])
    expect(diagnostics.at).toBe('2026-10-02T03:00:00.000Z')
    expect(diagnostics.runtimeSnapshot.apiVersion).toBe(runtime.apiVersion)
    expect(diagnostics.runtimeSnapshot.registry.rejected).toEqual([
      expect.objectContaining({ id: 'stray', errorCode: 'registry/invalid-entry' }),
    ])
    expect(report).toContain('abc123')
    expect(report).toContain('registry/invalid-entry')
    expect(report).toContain('- Mounted: none')
  })
})
