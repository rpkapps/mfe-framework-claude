import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { HOST_SCOPE, type BoundaryLocation } from '@company/mfe-core'

import { AgentContextStore, type AgentContextStoreOptions } from './agent-context-store.ts'
import { codesOf, recordingDiagnostics } from '../__tests__/harness.ts'

const owner = { definitionId: 'operations', mountToken: 'mount-1' }
const selectedWells = z.object({ ids: z.array(z.string()), label: z.string() })

function setup(options: AgentContextStoreOptions = {}) {
  const { hub, records } = recordingDiagnostics()
  let clock = 0
  const store = new AgentContextStore({
    diagnostics: hub,
    now: () => new Date(Date.UTC(2026, 8, 25, 12, 0, clock++)),
    ...options,
  })
  return { store, records }
}

function wells(ids: readonly string[]) {
  return {
    description: 'The wells the user has selected',
    schema: selectedWells,
    value: { ids: [...ids], label: `${String(ids.length)} wells` },
  }
}

describe('selections', () => {
  it('publishes what the mount selected, with when it was captured', () => {
    const { store } = setup()

    store.register(owner, wells(['W-1']))

    expect(store.getSnapshot()).toEqual([
      {
        definitionId: 'operations',
        description: 'The wells the user has selected',
        value: { ids: ['W-1'], label: '1 wells' },
        capturedAt: '2026-09-25T12:00:00.000Z',
      },
    ])
  })

  it('publishes what the schema parsed, not what the mount passed', () => {
    const { store } = setup()

    store.register(owner, {
      description: 'The focused well',
      schema: z.object({ id: z.string() }),
      value: { id: 'W-1', record: { secret: 'dropped' } },
    })

    expect(store.getSnapshot()[0]?.value).toEqual({ id: 'W-1' })
  })

  it('publishes nothing when an equal value is set again, and a new time when it changes', () => {
    const { store } = setup()
    const handle = store.register(owner, wells(['W-1']))
    const first = store.getSnapshot()

    handle.update(wells(['W-1']))
    expect(store.getSnapshot()).toBe(first)

    handle.update(wells(['W-1', 'W-2']))
    expect(store.getSnapshot()[0]).toMatchObject({
      value: { ids: ['W-1', 'W-2'] },
      capturedAt: '2026-09-25T12:00:01.000Z',
    })
  })

  it('keeps the capture time when only the description changes', () => {
    const { store } = setup()
    const handle = store.register(owner, wells(['W-1']))

    handle.update({ ...wells(['W-1']), description: 'The wells ticked in the inventory' })

    expect(store.getSnapshot()[0]).toMatchObject({
      description: 'The wells ticked in the inventory',
      capturedAt: '2026-09-25T12:00:00.000Z',
    })
  })

  it('leaves out a value its schema refuses, and reports it once while it stays refused', () => {
    const { store, records } = setup()
    const handle = store.register(owner, wells(['W-1']))

    const wrong: unknown = { ids: 'W-1', label: 'one' }
    const invalid = { ...wells([]), value: wrong as never }
    handle.update(invalid)
    handle.update(invalid)

    expect(store.getSnapshot()).toEqual([])
    expect(codesOf(records)).toEqual(['contract/input-mismatch'])

    handle.update(wells(['W-2']))
    expect(store.getSnapshot()).toHaveLength(1)
  })

  it('refuses a value that is not JSON, or too large to be a selection', () => {
    const { store, records } = setup()

    store.register(owner, {
      description: 'A callback',
      schema: z.any(),
      value: { run: () => undefined },
    })
    store.register(owner, {
      description: 'A whole record',
      schema: z.any(),
      value: { notes: 'x'.repeat(5000) },
    })

    expect(store.getSnapshot()).toEqual([])
    expect(records.map(record => record.error.message).join('\n')).toMatch(/over the 4096/)
    expect(codesOf(records)).toEqual(['contract/input-mismatch', 'contract/input-mismatch'])
  })

  it('refuses a registration without a description', () => {
    const { store } = setup()

    expect(() => store.register(owner, { ...wells(['W-1']), description: ' ' })).toThrow(
      /expected a description of what the value is/,
    )
  })

  it('leaves out a selection an update takes the description from, and reports it', () => {
    const { store, records } = setup()
    const handle = store.register(owner, wells(['W-1']))

    handle.update({ ...wells(['W-1']), description: '' })

    expect(store.getSnapshot()).toEqual([])
    expect(codesOf(records)).toEqual(['contract/input-mismatch'])
  })

  it('goes with its mount, and leaves another mount’s and the host page’s', () => {
    const { store } = setup()
    const late = store.register(owner, wells(['W-1']))
    store.register({ definitionId: 'reports', mountToken: 'mount-2' }, wells(['W-9']))
    store.registerHost({ description: 'The dashboard', schema: z.string(), value: 'Main' })

    store.removeMount('mount-1')
    late.update(wells(['W-3']))

    expect(store.getSnapshot().map(entry => entry.definitionId)).toEqual(['reports', HOST_SCOPE])
  })

  it('removes one selection through its handle', () => {
    const { store } = setup()
    const handle = store.register(owner, wells(['W-1']))
    const listener = vi.fn()
    store.subscribe(listener)

    handle.remove()
    handle.remove()

    expect(store.getSnapshot()).toEqual([])
    expect(listener).toHaveBeenCalledOnce()
  })
})

describe('the URL layer', () => {
  function at(pathname: string, search = ''): () => BoundaryLocation {
    return () => ({ pathname, search, hash: '' })
  }

  it('names every App the page is inside, with its own path, outermost first', () => {
    const { store } = setup({
      readLocation: at('/operations/wells/W-1', '?status=open&tag=a&tag=b'),
    })
    store.trackBoundary({
      definitionId: 'well-detail',
      mountToken: 'm-2',
      basePath: '/operations/wells',
    })
    store.trackBoundary({ definitionId: 'operations', mountToken: 'm-1', basePath: '/operations' })
    store.trackBoundary({ definitionId: 'reports', mountToken: 'm-3', basePath: '/reports' })

    expect(store.read()).toEqual({
      url: { pathname: '/operations/wells/W-1', search: { status: 'open', tag: ['a', 'b'] } },
      apps: [
        { definitionId: 'operations', basePath: '/operations', path: '/wells/W-1' },
        { definitionId: 'well-detail', basePath: '/operations/wells', path: '/W-1' },
      ],
      selections: [],
    })
  })

  it('reads the page when a turn is sent, not when the App mounted', () => {
    let pathname = '/operations'
    const { store } = setup({ readLocation: () => ({ pathname, search: '', hash: '' }) })
    store.trackBoundary({ definitionId: 'operations', mountToken: 'm-1', basePath: '/operations' })

    expect(store.read().apps[0]?.path).toBe('/')
    pathname = '/operations/assets'
    expect(store.read().apps[0]?.path).toBe('/assets')
  })

  it('forgets an App’s boundary with its mount', () => {
    const { store } = setup({ readLocation: at('/operations') })
    store.trackBoundary({ definitionId: 'operations', mountToken: 'm-1', basePath: '/operations' })

    store.removeMount('m-1')

    expect(store.read().apps).toEqual([])
  })
})

describe('prompt handoff', () => {
  it('hands the prompt to the chat, submitting unless told otherwise, and says who asked', () => {
    const { store } = setup()
    const handler = vi.fn()
    store.setPromptHandler(handler)

    expect(
      store.prompt({ message: 'Why is W-1 down?', context: { id: 'W-1' } }, 'operations'),
    ).toBe(true)
    expect(store.prompt({ message: 'Summarise this', submit: false })).toBe(true)

    expect(handler.mock.calls).toEqual([
      [
        {
          message: 'Why is W-1 down?',
          context: { id: 'W-1' },
          submit: true,
          definitionId: 'operations',
        },
      ],
      [{ message: 'Summarise this', submit: false, definitionId: HOST_SCOPE }],
    ])
  })

  it('answers false when no chat is there to take it', () => {
    const { store } = setup()
    const remove = store.setPromptHandler(vi.fn())
    remove()

    expect(store.prompt({ message: 'Hello' })).toBe(false)
  })

  it('refuses an empty message or context that is not a small piece of JSON', () => {
    const { store, records } = setup()
    const handler = vi.fn()
    store.setPromptHandler(handler)

    expect(store.prompt({ message: '  ' })).toBe(false)
    expect(store.prompt({ message: 'Look', context: 'x'.repeat(5000) })).toBe(false)

    expect(handler).not.toHaveBeenCalled()
    expect(codesOf(records)).toEqual(['contract/input-mismatch', 'contract/input-mismatch'])
  })

  it('keeps the handler it was given only until that handler is removed', () => {
    const { store } = setup()
    const first = vi.fn()
    const second = vi.fn()
    const removeFirst = store.setPromptHandler(first)
    store.setPromptHandler(second)

    removeFirst()
    store.prompt({ message: 'Hello' })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })
})

describe('suggestions', () => {
  it('offers a mount’s prompts with submit settled, and takes them away with the mount', () => {
    const { store } = setup()
    const listener = vi.fn()
    store.subscribeSuggestions(listener)

    store.suggest(owner, [
      { message: 'Which well is down?' },
      { message: 'Draft a note', submit: false },
    ])

    expect(store.getSuggestions()).toEqual([
      { definitionId: 'operations', message: 'Which well is down?', submit: true },
      { definitionId: 'operations', message: 'Draft a note', submit: false },
    ])
    store.removeMount('mount-1')
    expect(store.getSuggestions()).toEqual([])
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('publishes nothing for an equal list, and follows a changed one', () => {
    const { store } = setup()
    const handle = store.suggestHost([{ message: 'A', context: { id: 1 } }])
    const before = store.getSuggestions()

    handle.update([{ message: 'A', context: { id: 1 } }])
    expect(store.getSuggestions()).toBe(before)

    handle.update([{ message: 'B' }])
    expect(store.getSuggestions()).toEqual([
      { definitionId: HOST_SCOPE, message: 'B', submit: true },
    ])
    handle.remove()
    expect(store.getSuggestions()).toEqual([])
  })

  it('leaves out an empty or oversized suggestion and any past three, reporting it once', () => {
    const { store, records } = setup()
    const offered = [
      { message: ' ' },
      { message: 'A' },
      { message: 'B', context: { note: 'x'.repeat(5000) } },
      { message: 'C' },
      { message: 'D' },
      { message: 'E' },
    ]

    const handle = store.suggest(owner, offered)
    handle.update([...offered])

    expect(store.getSuggestions().map(entry => entry.message)).toEqual(['A', 'C', 'D'])
    expect(codesOf(records)).toEqual(['contract/input-mismatch'])
  })

  it('keeps the context it was offered when the author mutates its object afterwards', () => {
    const { store } = setup()
    const context = { ids: ['W-1'], label: '1 well' }
    store.suggest(owner, [{ message: 'Why is it down?', context }])

    context.ids.push('W-2')
    context.label = '2 wells'

    expect(store.getSuggestions()[0]?.context).toEqual({ ids: ['W-1'], label: '1 well' })
  })
})
