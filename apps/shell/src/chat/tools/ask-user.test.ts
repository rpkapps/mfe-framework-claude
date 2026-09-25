import { describe, expect, it } from 'vitest'

import { askUserTool, Questions } from './ask-user.ts'

const question = {
  questions: [
    {
      name: 'priority',
      question: 'What matters most?',
      choices: [{ value: 'cost', label: 'Cost' }],
    },
  ],
}

function context(signal = new AbortController().signal) {
  return { toolCallId: 'call-1', threadId: 't', runId: 'r', signal }
}

describe('ask_user', () => {
  it('waits for the answer the card gives, and returns it', async () => {
    const questions = new Questions()
    const answered = askUserTool(questions).execute(question, context())

    const pending = questions.getSnapshot().get('call-1')
    expect(pending?.input.questions[0]?.question).toBe('What matters most?')
    pending?.answer({ priority: 'cost' })

    expect(await answered).toEqual({ status: 'answered', answers: { priority: 'cost' } })
    expect(questions.getSnapshot().size).toBe(0)
  })

  it('answers declined when the user does not answer, or the turn is stopped', async () => {
    const questions = new Questions()
    const declined = askUserTool(questions).execute(question, context())
    questions.getSnapshot().get('call-1')?.decline()
    expect(await declined).toMatchObject({ status: 'declined' })

    const abort = new AbortController()
    const stopped = askUserTool(questions).execute(question, context(abort.signal))
    abort.abort()
    expect(await stopped).toMatchObject({ status: 'declined' })
    expect(questions.getSnapshot().size).toBe(0)
  })

  it('refuses questions its schema does not accept, without showing them', async () => {
    const questions = new Questions()
    const result: unknown = await askUserTool(questions).execute({ questions: [] }, context())
    expect(result).toMatchObject({ status: 'invalid' })
    expect(questions.getSnapshot().size).toBe(0)
  })
})
