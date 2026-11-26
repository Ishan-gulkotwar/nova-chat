/**
 * A tiny Server-Sent Events parser for fetch() response bodies.
 *
 * Network chunks don't line up with events: one chunk can hold several events,
 * or half of one. So we buffer text and only emit an event once we've seen the
 * blank line that ends it. Format spec:
 * https://html.spec.whatwg.org/multipage/server-sent-events.html
 */

export interface SSEEvent {
  event: string
  data: string
}

/** Parse one raw event block (the lines between blank lines). */
function parseBlock(block: string): SSEEvent | null {
  let event = 'message' // the spec's default event type
  const dataLines: string[] = []

  for (const line of block.split('\n')) {
    if (line === '' || line.startsWith(':')) continue // blank or comment
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)

    if (field === 'event') event = value
    else if (field === 'data') dataLines.push(value)
  }

  return dataLines.length > 0 ? { event, data: dataLines.join('\n') } : null
}

export async function* readSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      // Normalize CRLF so we only have to look for "\n\n".
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, '\n')

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const parsed = parseBlock(buffer.slice(0, boundary))
        buffer = buffer.slice(boundary + 2)
        if (parsed) yield parsed
        boundary = buffer.indexOf('\n\n')
      }
    }
    // Flush a final event that wasn't followed by a blank line.
    const tail = parseBlock(buffer + decoder.decode())
    if (tail) yield tail
  } finally {
    reader.releaseLock()
  }
}
