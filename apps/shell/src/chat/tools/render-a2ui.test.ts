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

  it('refuses a surface that would draw more components than a surface may', async () => {
    const surfaces = new A2uiSurfaces()
    const tool = renderA2uiTool(surfaces)
    // Thirteen components, each naming the next twice, that would draw 2^13 - 1.
    const components = Array.from({ length: 12 }, (_, level) => ({
      id: level === 0 ? 'root' : `l${String(level)}`,
      component: 'Column',
      children: [`l${String(level + 1)}`, `l${String(level + 1)}`],
    }))
    components.push({ id: 'l12', component: 'Column', children: [] })

    const result: unknown = await tool.execute({ surfaceId: 'fan', components }, call())

    expect(result).toMatchObject({
      status: 'invalid',
      error: { code: 'VALIDATION_FAILED', surfaceId: 'fan', path: '/components' },
    })
    expect(surfaces.getSnapshot().size).toBe(0)
  })

  it('takes a user’s input into the data model at once', async () => {
    const surfaces = new A2uiSurfaces()
    await renderA2uiTool(surfaces).execute(form, call())
    surfaces.write('note', '/note', 'Check the dump valve')
    expect(surfaces.getSnapshot().get('note')?.data).toEqual({ note: 'Check the dump valve' })
  })

  it('draws a surface deleted and created again where the call that created it again sits', async () => {
    const surfaces = new A2uiSurfaces()
    const tool = renderA2uiTool(surfaces)
    await tool.execute(form, call('call-1'))

    await tool.execute(
      { messages: [{ version: 'v0.9', deleteSurface: { surfaceId: 'note' } }] },
      call('call-2'),
    )
    expect(surfaces.createdBy('note')).toBeUndefined()

    await tool.execute(form, call('call-3'))
    expect(surfaces.createdBy('note')).toBe('call-3')
  })

  it('undoes what calls no longer in the history did, so a call that replaces one creates it anew', async () => {
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
    surfaces.write('note', '/note', 'Hi there')

    // Asked again from after the first call: the second goes, and the user's input with it.
    surfaces.prune(new Set(['call-1']))
    expect(surfaces.getSnapshot().get('note')?.data).toEqual({ note: '' })
    expect(surfaces.createdBy('note')).toBe('call-1')

    // Asked again from before it: the surface goes, and the new call draws it where it sits.
    surfaces.prune(new Set())
    expect(surfaces.getSnapshot().has('note')).toBe(false)
    expect(surfaces.createdBy('note')).toBeUndefined()
    await tool.execute(
      { surfaceId: 'note', components: [{ id: 'root', component: 'Text', text: 'Saved' }] },
      call('call-3'),
    )
    expect(surfaces.createdBy('note')).toBe('call-3')
    expect([...(surfaces.getSnapshot().get('note')?.components.keys() ?? [])]).toEqual(['root'])
  })

  it('brings back a surface a cut call deleted, where the call that created it sits', async () => {
    const surfaces = new A2uiSurfaces()
    const tool = renderA2uiTool(surfaces)
    await tool.execute(form, call('call-1'))
    await tool.execute(
      { messages: [{ version: 'v0.9', deleteSurface: { surfaceId: 'note' } }] },
      call('call-2'),
    )

    surfaces.prune(new Set(['call-1']))
    expect(surfaces.getSnapshot().get('note')?.data).toEqual({ note: '' })
    expect(surfaces.createdBy('note')).toBe('call-1')
  })

  it('refuses raw messages that name no surface', async () => {
    const result: unknown = await renderA2uiTool(new A2uiSurfaces()).execute(
      { messages: [{ version: 'v0.9' }] },
      call(),
    )
    expect(result).toMatchObject({ status: 'invalid', error: { path: '/surfaceId' } })
  })
})
