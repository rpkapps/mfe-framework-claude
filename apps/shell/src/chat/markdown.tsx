/**
 * A reply as Markdown, GitHub's flavour, in the chat's small type: models write lists, tables and
 * code, and shown as text they were a page of `**` and `|`. No raw HTML is rendered, only the
 * Markdown. A link to a page of this application goes through the router, so an App holding unsaved
 * changes holds it for a link too; any other goes to a new tab, saying where. An image is not
 * loaded: a reply's image would fetch a URL the model chose, which is how a prompt-injected model
 * sends data out, so it shows as its description and host until there is a policy for it (#31).
 */

import { useMemo, type ComponentProps, type MouseEvent, type ReactNode } from 'react'
import { CopyButton } from '@tecton/react/tecton/copy-button'
import { ExternalLinkIcon, ImageOffIcon } from 'lucide-react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { Go } from './tools/navigate.ts'

const PLUGINS = [remarkGfm]

/** Where a link goes: a page of this application, somewhere else, or nowhere it may. */
export function linkTarget(
  href: string | undefined,
  base: string,
):
  | { readonly kind: 'page'; readonly path: string }
  | { readonly kind: 'away'; readonly url: URL }
  | undefined {
  if (href === undefined || href === '') return undefined
  let url: URL
  try {
    url = new URL(href, base)
  } catch {
    return undefined
  }
  if (url.origin === new URL(base).origin) {
    return { kind: 'page', path: `${url.pathname}${url.search}${url.hash}` }
  }
  return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:'
    ? { kind: 'away', url }
    : undefined
}

/** A plain press: a modified or middle click keeps the browser's own meaning, a new tab. */
function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

function Link({
  go,
  href,
  children,
}: {
  readonly go: Go
  readonly href?: string | undefined
  readonly children?: ReactNode
}): ReactNode {
  const target = linkTarget(href, window.location.href)
  if (target === undefined) return <span>{children}</span>
  const className = 'font-medium text-primary underline underline-offset-2 hover:no-underline'

  if (target.kind === 'page') {
    return (
      <a
        href={target.path}
        className={className}
        onClick={event => {
          if (!isPlainClick(event)) return
          event.preventDefault()
          void go(target.path)
        }}
      >
        {children}
      </a>
    )
  }

  const where = target.url.protocol === 'mailto:' ? target.url.pathname : target.url.host
  return (
    <a
      href={target.url.href}
      target="_blank"
      rel="noopener noreferrer"
      title={target.url.href}
      className={`${className} inline-flex items-baseline gap-0.5`}
    >
      {children}
      <ExternalLinkIcon className="size-3 shrink-0 self-center" aria-hidden />
      <span className="sr-only">(opens {where} in a new tab)</span>
    </a>
  )
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node !== null && typeof node === 'object' && 'props' in node) {
    return textOf((node.props as { children?: ReactNode }).children)
  }
  return ''
}

function CodeBlock({ children }: ComponentProps<'pre'>): ReactNode {
  const code = textOf(children).replace(/\n$/, '')
  return (
    <div className="group/code relative">
      <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[0.6875rem] leading-relaxed">
        {children}
      </pre>
      <CopyButton
        value={code}
        size="icon-xs"
        aria-label="Copy the code"
        className="absolute end-1.5 top-1.5 opacity-0 group-focus-within/code:opacity-100 group-hover/code:opacity-100"
      />
    </div>
  )
}

function components(go: Go): Components {
  return {
    p: ({ children }) => <p>{children}</p>,
    a: ({ href, children }) => (
      <Link go={go} href={href}>
        {children}
      </Link>
    ),
    h1: ({ children }) => <h3 className="text-sm font-semibold">{children}</h3>,
    h2: ({ children }) => <h3 className="text-sm font-semibold">{children}</h3>,
    h3: ({ children }) => <h4 className="font-semibold">{children}</h4>,
    h4: ({ children }) => <h5 className="font-medium">{children}</h5>,
    h5: ({ children }) => <h6 className="font-medium">{children}</h6>,
    h6: ({ children }) => <h6 className="font-medium">{children}</h6>,
    ul: ({ children, className }) => (
      <ul
        className={
          className === 'contains-task-list'
            ? 'flex flex-col gap-1'
            : 'flex list-disc flex-col gap-1 ps-5'
        }
      >
        {children}
      </ul>
    ),
    ol: ({ children, start }) => (
      <ol start={start} className="flex list-decimal flex-col gap-1 ps-5">
        {children}
      </ol>
    ),
    blockquote: ({ children }) => (
      <blockquote className="flex flex-col gap-2 border-s-2 border-border ps-3 text-muted-foreground">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="border-border-subtle" />,
    pre: CodeBlock,
    code: ({ children, className }) =>
      // A fenced block's code is inside `pre`, which draws it; only inline code is drawn here.
      className === undefined ? (
        <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
      ) : (
        <code className={className}>{children}</code>
      ),
    table: ({ children }) => (
      <div className="overflow-x-auto rounded-md border border-border-subtle">
        <table className="w-full border-collapse text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
    tr: ({ children }) => (
      <tr className="border-b border-border-subtle last:border-b-0">{children}</tr>
    ),
    th: ({ children, style }) => (
      <th style={style} className="px-2 py-1.5 text-start font-medium">
        {children}
      </th>
    ),
    td: ({ children, style }) => (
      <td style={style} className="px-2 py-1.5 align-top">
        {children}
      </td>
    ),
    img: ({ alt, src }) => {
      const host = typeof src === 'string' ? linkTarget(src, window.location.href) : undefined
      return (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <ImageOffIcon className="size-3.5 shrink-0" aria-hidden />
          <span>
            Image not shown{alt ? `: ${alt}` : ''}
            {host?.kind === 'away' ? ` (${host.url.host})` : ''}
          </span>
        </span>
      )
    },
  }
}

/**
 * The reply's Markdown, drawn with the chat's components. `javascript:` and other links a person
 * could not follow are dropped by react-markdown's default URL check before `Link` sees them.
 */
export function Markdown({
  go,
  children,
}: {
  readonly go: Go
  readonly children: string
}): ReactNode {
  const drawn = useMemo(() => components(go), [go])
  return (
    <div data-slot="chat-markdown" className="flex min-w-0 flex-col gap-2 break-words">
      <ReactMarkdown remarkPlugins={PLUGINS} components={drawn}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
