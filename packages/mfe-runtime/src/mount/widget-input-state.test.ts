import { createMfeError, DEFINITION_BRAND } from '@company/mfe-core'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createMemoryRuntime } from '../testing/memory-runtime.ts'
import { mountDefinition } from './mount-definition.ts'
import type { MountableWidgetDefinition, WidgetMountTarget } from './mountable-definition.ts'

describe('hosted Widget input status', () => {
  it('preserves mounted content through rejection and host handler failure, clears the error after accepted input and ignores detached callbacks', async () => {
    const rejection = createMfeError({
      code: 'contract/input-mismatch',
      id: 'panel',
      operation: 'accept input',
    })
    let target: WidgetMountTarget | undefined
    const widget: MountableWidgetDefinition = {
      [DEFINITION_BRAND]: true,
      id: 'panel',
      kind: 'widget',
      framework: 'plain-dom',
      contract: { inputSchema: z.object({ label: z.string() }), outputSchema: z.object({}) },
      mount: async current => {
        target = current
        current.element.textContent = String(current.inputs['label'])
        return {
          update: inputs => {
            if (typeof inputs['label'] !== 'string') {
              current.onInputRejected?.(rejection)
              return
            }
            current.element.textContent = inputs['label']
          },
          dispose: async () => {
            current.element.replaceChildren()
          },
        }
      },
    }
    const memory = createMemoryRuntime({ definitions: [widget] })
    const host = document.createElement('div')
    document.body.appendChild(host)
    const rejected = vi.fn(() => {
      throw new Error('host handler failed')
    })
    const mount = mountDefinition({
      runtime: memory.runtime,
      element: host,
      definitionId: 'panel',
      kind: 'widget',
      inputs: { label: 'First' },
      onOutput: () => undefined,
      onInputRejected: rejected,
    })
    await vi.waitFor(() => {
      expect(mount.getState().status).toBe('mounted')
    })
    const changed = vi.fn()
    const unsubscribe = mount.subscribeInput(changed)

    mount.update({ label: 9 })
    expect(mount.getState().status).toBe('mounted')
    expect(mount.getInputState()).toEqual({ status: 'rejected', error: rejection })
    expect(host.textContent).toBe('First')
    expect(rejected).toHaveBeenCalledTimes(1)
    expect(memory.diagnostics.at(-1)?.error.message).toContain('host handler failed')

    mount.update({ label: 'Second' })
    expect(mount.getInputState()).toEqual({ status: 'accepted' })
    expect(host.textContent).toBe('Second')
    expect(changed).toHaveBeenCalledTimes(2)
    await mount.dispose()
    target?.onInputRejected?.(rejection)
    expect(rejected).toHaveBeenCalledTimes(1)
    expect(mount.getInputState()).toEqual({ status: 'accepted' })
    unsubscribe()
    host.remove()
    memory.dispose()
  })
})
