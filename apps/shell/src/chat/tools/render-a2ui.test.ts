import { describe, expect, it } from 'vitest'

import { TECTON_CATALOGUE_ID } from '../a2ui/catalogue.ts'
import { A2uiSurfaces } from '../a2ui/surfaces.ts'
import { renderA2uiTool } from './render-a2ui.ts'

const call = (toolCallId = 'call-1') => ({
  toolCallId,
  threadId: 't',
  runId: 'r',
  signal: new AbortController().signal,
})

const form = {
  surfaceId: 'note',
  components: [
    { id: 'root', component: 'Column', children: ['field', 'send'] },
    { id: 'field', component: 'TextField', label: 'Note', value: { path: '/note' } },
    {
      id: 'send',
      component: 'Button',
      child: 'label',
      action: { event: { name: 'save', context: { note: { path: '/note' } } } },
    },
    { id: 'label', component: 'Text', text: 'Save' },
  ],
  data: { note: '' },
}

describe('render_a2ui', () => {
  it('draws the middleware’s shorthand on a surface of the host’s catalogue', async () => {
    const surfaces = new A2uiSurfaces()
    const tool = renderA2uiTool(surfaces)

    expect(await tool.execute(form, call())).toEqual({ status: 'rendered', surfaceId: 'note' })
    expect(surfaces.getSnapshot().get('note')).toMatchObject({
      catalogId: TECTON_CATALOGUE_ID,
      data: { note: '' },
    })
    expect(surfaces.createdBy('note')).toBe('call-1')
  })

  it('updates a surface a later call names, which stays with the call that created it', async () => {
    const surfaces = new A2uiSurfaces()
    const tool = renderA2uiTool(surfaces)
    await tool.execute(form, call('call-1'))

    await tool.execute(
      {
        messages: [
          { version: 'v0.9', updateDataModel: { surfaceId: 'note', path: '/note', value: 'Hi' } },
        ],
      },
      call('call-2'),
    )

    expect(surfaces.getSnapshot().get('note')?.data).toEqual({ note: 'Hi' })
    expect(surfaces.createdBy('note')).toBe('call-1')
  })

  it('refuses what the catalogue lacks and a surface with no root, and lets the agent retry', async () => {
    const surfaces = new A2uiSurfaces()
    const tool = renderA2uiTool(surfaces)

    const unknown: unknown = await tool.execute(
      { surfaceId: 's', components: [{ id: 'root', component: 'Iframe' }] },
      call(),
    )
    expect(unknown).toMatchObject({ status: 'invalid', error: { code: 'UNKNOWN_COMPONENT' } })
    const rootless: unknown = await tool.execute(
      { surfaceId: 's2', components: [{ id: 'a', component: 'Text', text: 'x' }] },
      call(),
    )
    expect(rootless).toMatchObject({ status: 'invalid', error: { path: '/components' } })
    expect(surfaces.getSnapshot().size).toBe(0)

    const followUp = tool.followUp
    expect(typeof followUp === 'function' && followUp(unknown)).toBe(true)
    expect(typeof followUp === 'function' && followUp({ status: 'rendered' })).toBe(false)
  })

  it('takes a user’s input into the data model at once', async () => {
    const surfaces = new A2uiSurfaces()
    await renderA2uiTool(surfaces).execute(form, call())
    surfaces.write('note', '/note', 'Check the dump valve')
    expect(surfaces.getSnapshot().get('note')?.data).toEqual({ note: 'Check the dump valve' })
  })
})
