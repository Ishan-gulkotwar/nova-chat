import { describe, expect, it } from 'vitest'

import { readSSE, type SSEEvent } from './sse.ts'

/** Build a stream that delivers the given strings as separate network chunks. */
function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<SSEEvent[]> {
  const events: SSEEvent[] = []
  for await (const event of readSSE(stream)) events.push(event)
  return events
}

describe('readSSE', () => {
  it('parses several events in one chunk', async () => {
    const events = await collect(
      streamOf('event: token\ndata: {"content":"Hi"}\n\nevent: done\ndata: {}\n\n'),
    )
    expect(events).toEqual([
      { event: 'token', data: '{"content":"Hi"}' },
      { event: 'done', data: '{}' },
    ])
  })

  it('reassembles an event split across chunks', async () => {
    const events = await collect(streamOf('event: tok', 'en\ndata: {"content":', '"Hi"}\n', '\n'))
    expect(events).toEqual([{ event: 'token', data: '{"content":"Hi"}' }])
  })

  it('handles CRLF line endings, comments and the default event type', async () => {
    const events = await collect(streamOf(': keep-alive\r\n\r\ndata: plain\r\n\r\n'))
    expect(events).toEqual([{ event: 'message', data: 'plain' }])
  })

  it('flushes a trailing event without a final blank line', async () => {
    const events = await collect(streamOf('event: done\ndata: {}'))
    expect(events).toEqual([{ event: 'done', data: '{}' }])
  })
})
