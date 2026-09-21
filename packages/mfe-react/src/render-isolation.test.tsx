/**
 * The render-isolation gate: isolated probes keep an ordinary parent re-render from looking like
 * subscription fan-out, and commits are counted because a cached render hides upstream work.
 */

import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { useState, type ReactNode } from 'react'

import { createMfeTestEnvironment, type MfeTestEnvironment } from './testing/index.tsx'
import { createWidget } from './definition.ts'
import { useCommand } from './hooks/use-command.ts'
import { useGroups, useTheme, useUser } from './hooks/shell-state.ts'
import { useStoredState } from './hooks/use-stored-state.ts'
import { WidgetMount } from './widget-mount.tsx'
import { allow } from '@company/mfe-core'

let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  const current = environment
  environment = null
  await current?.dispose()
})

function setup(options?: Parameters<typeof createMfeTestEnvironment>[0]): MfeTestEnvironment {
  environment = createMfeTestEnvironment(options)
  return environment
}

/** A probe that records every commit it performs. */
function makeProbe(name: string, useValue: () => unknown) {
  const commits = { count: 0 }

  function Probe(): ReactNode {
    commits.count += 1
    const value = useValue()
    return <span data-testid={name}>{String(value)}</span>
  }

  return { Probe, commits }
}

describe('shell state fans out only to the field that changed', () => {
  it('a theme change does not commit a user probe or a groups probe', () => {
    const env = setup()

    const theme = makeProbe('theme', () => useTheme())
    const user = makeProbe('user', () => useUser()?.name ?? 'none')
    const groups = makeProbe('groups', () => useGroups().length)

    render(
      <env.wrapper>
        <theme.Probe />
        <user.Probe />
        <groups.Probe />
      </env.wrapper>,
    )

    const baseline = {
      theme: theme.commits.count,
      user: user.commits.count,
      groups: groups.commits.count,
    }

    env.setShellState({ theme: 'dark' })

    expect(theme.commits.count).toBe(baseline.theme + 1)
    expect(user.commits.count).toBe(baseline.user)
    expect(groups.commits.count).toBe(baseline.groups)
  })

  it('a user change does not commit a theme probe', () => {
    const env = setup()

    const theme = makeProbe('theme', () => useTheme())
    const user = makeProbe('user', () => useUser()?.name ?? 'none')

    render(
      <env.wrapper>
        <theme.Probe />
        <user.Probe />
      </env.wrapper>,
    )

    const themeBaseline = theme.commits.count
    env.setShellState({ user: { id: 'u-2', name: 'Grace Hopper' } })

    expect(screen.getByTestId('user')).toHaveTextContent('Grace Hopper')
    expect(theme.commits.count).toBe(themeBaseline)
  })

  it('a selector narrows the subscription further', () => {
    const env = setup({ shellState: { user: { id: 'u-1', name: 'Ada' } } })

    // Selects a boolean, so a name change that keeps the user signed in is not a change here.
    const signedIn = makeProbe('signed-in', () => useUser(user => user != null))

    render(
      <env.wrapper>
        <signedIn.Probe />
      </env.wrapper>,
    )

    const baseline = signedIn.commits.count
    env.setShellState({ user: { id: 'u-1', name: 'Ada Lovelace' } })

    expect(signedIn.commits.count).toBe(baseline)
  })

  it('republishing an identical value commits nobody', () => {
    const env = setup({ shellState: { theme: 'light' } })
    const theme = makeProbe('theme', () => useTheme())

    render(
      <env.wrapper>
        <theme.Probe />
      </env.wrapper>,
    )

    const baseline = theme.commits.count
    env.setShellState({ theme: 'light' })

    expect(theme.commits.count).toBe(baseline)
  })
})

describe('storage fans out per key', () => {
  const densitySchema = z.enum(['comfortable', 'compact'])
  const localeSchema = z.string()

  function makeDensityProbe(capture?: (setter: (next: 'comfortable' | 'compact') => void) => void) {
    return makeProbe('density', () => {
      const [value, setter] = useStoredState('table-density', densitySchema, {
        defaultValue: 'comfortable',
        retention: 'browser',
      })
      capture?.(setter)
      return value
    })
  }

  it('writing one key does not commit a probe subscribed to a different key', () => {
    const env = setup()

    let setDensity: ((next: 'comfortable' | 'compact') => void) | null = null
    const density = makeDensityProbe(setter => (setDensity = setter))

    const locale = makeProbe('locale', () => {
      const [value] = useStoredState('locale', localeSchema, {
        defaultValue: 'en',
        retention: 'browser',
      })
      return value
    })

    render(
      <env.wrapper>
        <density.Probe />
        <locale.Probe />
      </env.wrapper>,
    )

    const localeBaseline = locale.commits.count

    act(() => setDensity?.('compact'))

    expect(screen.getByTestId('density')).toHaveTextContent('compact')
    expect(locale.commits.count).toBe(localeBaseline)
  })

  it('writing the same value again publishes no changed snapshot', () => {
    const env = setup()
    let setDensity: ((next: 'comfortable' | 'compact') => void) | null = null
    const density = makeDensityProbe(setter => (setDensity = setter))

    render(
      <env.wrapper>
        <density.Probe />
      </env.wrapper>,
    )

    act(() => setDensity?.('compact'))
    const baseline = density.commits.count

    act(() => setDensity?.('compact'))

    expect(density.commits.count).toBe(baseline)
  })

  it('reading a snapshot repeatedly does not touch the browser store', () => {
    const env = setup()
    // The injected memory area counts its own getItem calls.
    const reads = (): number => env.storageAreas.local.calls.reads
    const probe = makeDensityProbe()

    const tree = (
      <env.wrapper>
        <probe.Probe />
      </env.wrapper>
    )
    const { rerender } = render(tree)

    const afterMount = reads()

    for (let index = 0; index < 5; index += 1) rerender(tree)

    // The snapshot is cached by its raw serialized form, so re-rendering never re-parses.
    expect(reads()).toBe(afterMount)
    expect(afterMount).toBeGreaterThan(0)
  })
})

describe('commands publish only when visible state changes', () => {
  it('a rerender with equivalent visible state publishes no palette snapshot', () => {
    const env = setup()
    let bump: (() => void) | null = null

    function Owner(): ReactNode {
      const [, setTick] = useState(0)
      bump = () => setTick(current => current + 1)

      // Inline callbacks, new closures on every render, as an author would write.
      useCommand({
        name: 'refresh',
        label: 'Refresh data',
        canExecute: () => allow(),
        execute: () => {},
      })

      return null
    }

    const palette = makeProbe('palette', () => env.runtime.commands.getSnapshot().length)

    render(
      <env.wrapper>
        <Owner />
        <palette.Probe />
      </env.wrapper>,
    )

    const snapshot = env.runtime.commands.getSnapshot()
    const paletteBaseline = palette.commits.count

    act(() => bump?.())
    act(() => bump?.())

    // The snapshot keeps its identity, so a subscriber sees no change at all.
    expect(env.runtime.commands.getSnapshot()).toBe(snapshot)
    expect(palette.commits.count).toBe(paletteBaseline)
  })

  it('updating one command does not re-evaluate a command owned by another component', () => {
    const env = setup()
    const otherCanExecute = vi.fn(() => allow())
    let setLabel: ((next: string) => void) | null = null

    // Separate components, so an availability check must not run for an unrelated change.
    function RefreshOwner(): ReactNode {
      const [label, setter] = useState('Refresh data')
      setLabel = setter
      useCommand({ name: 'refresh', label, execute: () => {} })
      return null
    }

    function ExportOwner(): ReactNode {
      useCommand({
        name: 'export',
        label: 'Export',
        canExecute: otherCanExecute,
        execute: () => {},
      })
      return null
    }

    render(
      <env.wrapper>
        <RefreshOwner />
        <ExportOwner />
      </env.wrapper>,
    )

    const baseline = otherCanExecute.mock.calls.length
    act(() => setLabel?.('Reload data'))

    expect(otherCanExecute.mock.calls.length).toBe(baseline)
    expect(env.runtime.commands.getSnapshot().find(entry => entry.name === 'refresh')?.label).toBe(
      'Reload data',
    )
  })

  it('opening the palette is the only path that re-evaluates every command', () => {
    const env = setup()
    const canExecute = vi.fn(() => allow())

    function Owner(): ReactNode {
      useCommand({ name: 'export', label: 'Export', canExecute, execute: () => {} })
      return null
    }

    render(
      <env.wrapper>
        <Owner />
      </env.wrapper>,
    )

    const baseline = canExecute.mock.calls.length
    env.runtime.commands.evaluateAll()

    expect(canExecute.mock.calls.length).toBeGreaterThan(baseline)
  })

  it('unmounting removes the registration', () => {
    const env = setup()

    function Owner(): ReactNode {
      useCommand({ name: 'refresh', label: 'Refresh data', execute: () => {} })
      return null
    }

    const { unmount } = render(
      <env.wrapper>
        <Owner />
      </env.wrapper>,
    )

    expect(env.runtime.commands.size).toBe(1)
    unmount()
    expect(env.runtime.commands.size).toBe(0)
  })
})

describe('Widget inputs and handlers', () => {
  const probeWidget = createWidget({
    id: 'probe-widget',
    inputs: z.object({ value: z.string() }),
    events: { changed: z.object({ value: z.string() }) },
    render: ({ inputs }) => <span data-testid="widget-value">{inputs.value}</span>,
  })

  function widgetTree(
    env: MfeTestEnvironment,
    inputs: Record<string, unknown>,
    handlers: Record<string, (payload: unknown) => void>,
  ): ReactNode {
    return (
      <env.wrapper>
        <WidgetMount
          definition={probeWidget}
          mount={env.mount}
          inputs={inputs}
          handlers={handlers}
        />
      </env.wrapper>
    )
  }

  it('replacing only a handler does not revalidate inputs or re-render the Widget', () => {
    const env = setup({ definitionId: 'probe-widget', kind: 'widget' })
    const inputs = { value: 'stable' }

    const { rerender } = render(widgetTree(env, inputs, { changed: () => {} }))
    const parseCount = (): number => env.telemetry.records.length

    const before = parseCount()

    // A new handler closure on every render, with the same input object.
    for (let index = 0; index < 3; index += 1) {
      rerender(widgetTree(env, inputs, { changed: () => index }))
    }

    expect(screen.getByTestId('widget-value')).toHaveTextContent('stable')
    expect(parseCount()).toBe(before)
  })

  it('an equal but freshly allocated input object does not remount the Widget', () => {
    const env = setup({ definitionId: 'probe-widget', kind: 'widget' })

    const { rerender } = render(widgetTree(env, { value: 'same' }, {}))
    const node = screen.getByTestId('widget-value')

    rerender(widgetTree(env, { value: 'same' }, {}))

    // The same DOM node means the inputs compared equal and nothing remounted.
    expect(screen.getByTestId('widget-value')).toBe(node)
  })

  it('a rejected input update keeps the last valid inputs rendered', () => {
    const env = setup({ definitionId: 'probe-widget', kind: 'widget' })

    const { rerender } = render(widgetTree(env, { value: 'good' }, {}))
    expect(screen.getByTestId('widget-value')).toHaveTextContent('good')

    rerender(widgetTree(env, { value: 42 }, {}))

    // The update was rejected; the mount stayed mounted with its last good value.
    expect(screen.getByTestId('widget-value')).toHaveTextContent('good')
    expect(env.diagnostics.some(entry => entry.error.code === 'contract/input-mismatch')).toBe(true)
  })
})

describe('teardown returns resources to baseline', () => {
  it('repeated mount and dispose leaves no commands, subscriptions or overlay roots behind', async () => {
    const overlayCount = (): number => document.querySelectorAll('[data-mfe-overlay-root]').length
    const baselineOverlays = overlayCount()

    for (let iteration = 0; iteration < 3; iteration += 1) {
      const env = createMfeTestEnvironment({ definitionId: 'probe-app' })

      function Owner(): ReactNode {
        useCommand({ name: 'refresh', label: 'Refresh', execute: () => {} })
        useTheme()
        return null
      }

      const { unmount } = render(
        <env.wrapper>
          <Owner />
        </env.wrapper>,
      )

      expect(env.runtime.commands.size).toBe(1)
      expect(env.runtime.shellState.fieldListenerCount('theme')).toBe(1)

      unmount()
      await env.dispose()

      expect(env.runtime.commands.size).toBe(0)
      expect(env.runtime.shellState.fieldListenerCount('theme')).toBe(0)
    }

    expect(overlayCount()).toBe(baselineOverlays)
  })
})

describe('scaling: one change does not touch unrelated consumers', () => {
  it('writing one of many storage keys commits only that key’s probe', () => {
    const env = setup()
    const schema = z.string()
    const KEY_COUNT = 40

    const commits = new Array<number>(KEY_COUNT).fill(0)
    const setters: ((next: string) => void)[] = []

    function KeyProbe({ index }: { readonly index: number }): ReactNode {
      commits[index] = (commits[index] ?? 0) + 1
      const [value, setter] = useStoredState(`key-${index}`, schema, {
        defaultValue: 'initial',
        retention: 'browser',
      })
      setters[index] = setter
      return <span>{value}</span>
    }

    render(
      <env.wrapper>
        {Array.from({ length: KEY_COUNT }, (_, index) => (
          <KeyProbe key={index} index={index} />
        ))}
      </env.wrapper>,
    )

    const baseline = [...commits]
    act(() => setters[7]?.('changed'))

    for (let index = 0; index < KEY_COUNT; index += 1) {
      const expected = index === 7 ? (baseline[index] ?? 0) + 1 : baseline[index]
      expect(commits[index], `probe ${index}`).toBe(expected)
    }
  })
})
