import { describe, expect, it } from 'vitest'
import { HOST_SCOPE } from '@company/mfe-react'

import { actionAttachment, chatCommands, NEW_CONVERSATION } from './commands.ts'
import type { ActionEntry } from './hooks.ts'

function action(id: string, name: string, label: string): ActionEntry {
  const definitionId = id.split(':', 1)[0] ?? id
  const entry: ActionEntry = {
    id,
    definitionId,
    name,
    label,
    placements: ['palette', 'agent'],
    effect: 'write',
    followUp: true,
    decision: { allowed: true },
  }
  return entry
}

describe('chatCommands', () => {
  it('puts the chat’s own first, then the page’s actions, then the shell’s, each one word', () => {
    const commands = chatCommands([
      action(`${HOST_SCOPE}:help`, 'help', 'Help'),
      action('alerts:acknowledge', 'acknowledge', 'Acknowledge alert A-7'),
      action('wells:Add Note', 'Add Note', 'Add a note'),
    ])

    expect(commands.map(command => [command.command, command.group, command.description])).toEqual([
      ['new', 'Chat', undefined],
      ['acknowledge', 'This page', 'alerts'],
      ['add-note', 'This page', 'wells'],
      ['help', 'Everywhere', undefined],
    ])
    expect(commands[0]).toBe(NEW_CONVERSATION)
  })

  it('tells two mounts’ actions of one name apart, and never takes the chat’s own', () => {
    const commands = chatCommands([
      action('alerts:ack', 'ack', 'Acknowledge A-7'),
      action('alerts:ack-2', 'ack', 'Acknowledge A-8'),
      action('app:new', 'new', 'New well'),
    ])

    expect(commands.map(command => command.command)).toEqual(['new', 'ack', 'ack-2', 'new-2'])
  })
})

describe('actionAttachment', () => {
  it('is a chip that sends the tool name as the turn’s context', () => {
    const attachment = actionAttachment(
      action('alerts:acknowledge', 'acknowledge', 'Acknowledge alert A-7'),
    )

    expect(attachment).toMatchObject({
      id: 'action:alerts:acknowledge',
      kind: 'action',
      label: 'Acknowledge alert A-7',
      context: { value: 'alerts__acknowledge' },
    })
  })
})
