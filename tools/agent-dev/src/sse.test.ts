import { describe, expect, it } from 'vitest'

import { serverSentEvents } from './sse.ts'

/** A body that arrives in exactly these pieces. */
function body(...pieces: readonly (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) {
        controller.enqueue(typeof piece === 'string' ? encoder.encode(piece) : piece)
      }
      controller.close()
    },
  })
}

async function read(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = []
  for await (const data of serverSentEvents(stream)) out.push(data)
  return out
}

describe('serverSentEvents', () => {
  it('reads LF, CRLF and CR line ends, however the chunks cut them', async () => {
    expect(await read(body('data: a\n\ndata: b\r\n\r', '\ndata: c\r\rdata: d\r\n\r\n'))).toEqual([
      'a',
      'b',
      'c',
      'd',
    ])
  })

  it('joins an event’s data lines, and skips comments, other fields and events without data', async () => {
    expect(
      await read(
        body(': keep-alive\n\n', 'event: x\nid: 1\ndata: {"a":\ndata:1}\nretry: 5\n\n', 'data\n\n'),
      ),
    ).toEqual(['{"a":\n1}', ''])
  })

  it('drops one space after the colon, and keeps the rest', async () => {
    expect(await read(body('data:x\n\ndata:  y\n\n'))).toEqual(['x', ' y'])
  })

  it('keeps a character cut between two chunks whole', async () => {
    const bytes = new TextEncoder().encode('data: é\n\n')
    expect(await read(body(bytes.slice(0, 7), bytes.slice(7)))).toEqual(['é'])
  })

  it('sends a last event the server did not end with a blank line', async () => {
    expect(await read(body('data: a\n\ndata: b'))).toEqual(['a', 'b'])
  })
})
