/**
 * A host builds a Widget's inputs from its props on every render. What must not follow from an
 * equal set is work: the runtime drops it anyway, so passing it on only repeats a comparison.
 */

import type * as Runtime from '@company/mfe-runtime'
import type { WidgetDefinitionMount, WidgetMountRequest } from '@company/mfe-runtime'
import { render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createWidget } from './definition.ts'
import { lazyWidget } from './lazy-widget.tsx'
import { MfeProvider } from './runtime-context.tsx'
import { createMfeTestEnvironment, type MfeTestEnvironment } from './testing/index.tsx'

/** Every input set a host handed the runtime's mount handle, in order. */
const handedOver: Readonly<Record<string, unknown>>[] = []

vi.mock('@company/mfe-runtime', async importOriginal => {
  const actual = await importOriginal<typeof Runtime>()
  return {
    ...actual,
    mountDefinition: (request: WidgetMountRequest): WidgetDefinitionMount => {
      const mount = actual.mountDefinition(request)
      const update = mount.update.bind(mount)
      return Object.assign(mount, {
        update: (inputs: Readonly<Record<string, unknown>>) => {
          handedOver.push(inputs)
          update(inputs)
        },
      })
    },
  }
})

let environment: MfeTestEnvironment | null = null

afterEach(async () => {
  handedOver.length = 0
  const current = environment
  environment = null
  await current?.dispose()
})

const label = createWidget({
  id: 'label-widget',
  inputs: z.object({ text: z.string() }),
  events: {},
  render: ({ inputs }): ReactNode => <p>{inputs.text}</p>,
})

const LabelWidget = lazyWidget('label-widget')

function Page({ text, tick }: { readonly text: string; readonly tick: number }): ReactNode {
  return (
    <div data-tick={tick}>
      <LabelWidget text={text} />
    </div>
  )
}

describe('a Widget host re-rendering', () => {
  it('hands the mount a new input set only when its values changed', async () => {
    environment = createMfeTestEnvironment({ definitions: [label] })
    const { runtime } = environment
    const page = (text: string, tick: number): ReactNode => (
      <MfeProvider runtime={runtime}>
        <Page text={text} tick={tick} />
      </MfeProvider>
    )

    const { rerender } = render(page('first', 0))
    await waitFor(() => {
      expect(screen.getByText('first')).toBeInTheDocument()
    })
    const afterMount = handedOver.length

    rerender(page('first', 1))
    rerender(page('first', 2))
    expect(handedOver).toHaveLength(afterMount)

    rerender(page('second', 3))
    await waitFor(() => {
      expect(screen.getByText('second')).toBeInTheDocument()
    })
    expect(handedOver.slice(afterMount)).toEqual([{ text: 'second' }])
  })
})
