import { describe, expect, it } from 'vitest'

import { ChatPanel } from './panel.ts'

describe('ChatPanel', () => {
  it('quotes the selection as a chip and asks the composer for focus once per request', () => {
    const panel = new ChatPanel()
    panel.askAbout('  A-7 is flaring ')

    expect(panel.getSnapshot()).toMatchObject({
      open: true,
      focusRequest: 1,
      attachments: [{ id: 'selection', description: 'A-7 is flaring', quote: '> A-7 is flaring' }],
    })
    expect(panel.takeFocusRequest(1)).toBe(true)
    // A panel mounted again later, by an approval opening it, leaves focus where the user has it.
    panel.hide()
    panel.show()
    expect(panel.takeFocusRequest(panel.getSnapshot().focusRequest)).toBe(false)
  })

  it('only opens with no selection, and empties the composer', () => {
    const panel = new ChatPanel()
    panel.askAbout('   ')
    panel.setDraft('Why?')
    expect(panel.getSnapshot()).toMatchObject({ open: true, attachments: [], draft: 'Why?' })

    panel.clearComposer()
    expect(panel.getSnapshot()).toMatchObject({ open: true, attachments: [], draft: '' })
  })
})
