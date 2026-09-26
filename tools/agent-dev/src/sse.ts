/**
 * Server-sent events from a model's streamed response, one event's `data` at a time, unparsed.
 * Lines end in LF, CRLF or CR, which may be cut between two chunks; an event's `data:` lines are
 * joined with a newline, and one space after the colon is dropped, as the SSE spec reads them.
 */
export async function* serverSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffered = ''
  let data: string[] = []

  /** The complete lines in the buffer, which keeps the rest. */
  function* lines(final: boolean): Generator<string> {
    for (;;) {
      const end = buffered.search(/\r\n|\r|\n/)
      // A CR last in the buffer may be the first half of a CRLF.
      if (end === -1 || (!final && end === buffered.length - 1 && buffered[end] === '\r')) return
      const line = buffered.slice(0, end)
      buffered = buffered.slice(end + (buffered.startsWith('\r\n', end) ? 2 : 1))
      yield line
    }
  }

  /** The event a blank line ends, if it carried data. */
  function dispatch(): string | undefined {
    const event = data.length === 0 ? undefined : data.join('\n')
    data = []
    return event
  }

  function read(line: string): string | undefined {
    if (line === '') return dispatch()
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    if (field !== 'data') return undefined
    const value = colon === -1 ? '' : line.slice(colon + 1)
    data.push(value.startsWith(' ') ? value.slice(1) : value)
    return undefined
  }

  for await (const chunk of body) {
    buffered += decoder.decode(chunk, { stream: true })
    for (const line of lines(false)) {
      const event = read(line)
      if (event !== undefined) yield event
    }
  }

  // The stream ended: what is left is the last line, and an event a server did not end with a
  // blank line is still sent rather than lost.
  buffered += decoder.decode()
  for (const line of lines(true)) {
    const event = read(line)
    if (event !== undefined) yield event
  }
  if (buffered !== '') read(buffered)
  const last = dispatch()
  if (last !== undefined) yield last
}
