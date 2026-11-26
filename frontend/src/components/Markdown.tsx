import { useRef, useState, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

/** A <pre> code block with a "Copy" button in the corner. */
function CodeBlock(props: ComponentPropsWithoutRef<'pre'>) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)

  async function copy() {
    const text = preRef.current?.innerText ?? ''
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={copy}
        className="absolute top-2 right-2 rounded-md bg-zinc-700/80 px-2 py-1 text-xs text-zinc-200 opacity-0 transition group-hover:opacity-100 focus:opacity-100"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre ref={preRef} {...props} />
    </div>
  )
}

/**
 * Renders model output as Markdown: GitHub-flavored Markdown (tables, task
 * lists, strikethrough) plus syntax-highlighted code blocks.
 *
 * react-markdown builds React elements and never uses innerHTML, and raw HTML
 * in the model's output is ignored, so a reply can't inject scripts.
 */
export function Markdown({ content }: { content: string }) {
  return (
    <div className="prose prose-invert prose-zinc max-w-none prose-pre:bg-zinc-950 prose-pre:p-0 prose-pre:border prose-pre:border-zinc-800 prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{ pre: CodeBlock }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
