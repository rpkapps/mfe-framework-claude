/** Server-sent events from a model's streamed response, one `data:` payload at a time, unparsed. */
export async function* serverSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffered = ''
  for await (const chunk of body) {
    // Some servers end lines with CRLF; the frames are the same.
    buffered += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n')
    let end = buffered.indexOf('\n\n')
    while (end !== -1) {
      const frame = buffered.slice(0, end)
      buffered = buffered.slice(end + 2)
      const data = frame
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
      if (data !== '') yield data
      end = buffered.indexOf('\n\n')
    }
  }
}
