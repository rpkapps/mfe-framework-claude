/**
 * A reply as Markdown, GitHub's flavour, in the chat's small type: models write lists, tables and
 * code, and shown as text they were a page of `**` and `|`. No raw HTML is rendered, only the
 * Markdown. A link to a page of this application goes through the router, so an App holding unsaved
 * changes holds it for a link too; any other goes to a new tab, saying where. An image is not
 * loaded: a reply's image would fetch a URL the model chose, which is how a prompt-injected model
 * sends data out, so it shows as its description and host. An agent that means to show an image
 * uses A2UI's Image, which loads only from where the deployment allows (decisions §51).
 */

import {
  Children,
  Fragment,
  isValidElement,
  useMemo,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { CopyButton } from '@tecton/react/tecton/copy-button'
import { ExternalLinkIcon, ImageOffIcon } from 'lucide-react'
import { Markdown as MarkdownToJsx, type MarkdownToJSX } from 'markdown-to-jsx/react'

import type { Go } from './tools/navigate.ts'

/**
 * Where a link goes: a page of this application, somewhere else, or nowhere it may. The parser
 * leaves out an address it finds unsafe, so an `href` may be missing.
 */
export function linkTarget(
  href: string | null | undefined,
  base: string,
):
  | { readonly kind: 'page'; readonly path: string }
  | { readonly kind: 'away'; readonly url: URL }
  | undefined {
  if (typeof href !== 'string' || href === '') return undefined
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
  readonly href?: string | null | undefined
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

/**
 * A fenced or indented block, drawn from its text alone: the parser's inner `code` would be drawn
 * as inline code, and it carries whatever attributes the fence's info string named.
 */
function CodeBlock({ children }: { readonly children?: ReactNode }): ReactNode {
  const code = textOf(children).replace(/\n$/, '')
  return (
    <div className="group/code relative">
      <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[0.6875rem] leading-relaxed">
        <code>{code}</code>
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

/** A task's box shows whether it is done; it is not the user's to tick. */
function TaskBox({ checked }: { readonly checked?: boolean }): ReactNode {
  return <input type="checkbox" checked={checked === true} disabled />
}

/** A GitHub task list, whose items hold their box: drawn without bullets. */
function isTaskList(items: ReactNode): boolean {
  return Children.toArray(items).some(
    item =>
      isValidElement<{ children?: ReactNode }>(item) &&
      Children.toArray(item.props.children).some(
        child => isValidElement(child) && child.type === TaskBox,
      ),
  )
}

interface Drawn {
  readonly children?: ReactNode
}

function overrides(go: Go): MarkdownToJSX.Overrides {
  return {
    a: ({ href, children }: Drawn & { readonly href?: string | null }) => (
      <Link go={go} href={href}>
        {children}
      </Link>
    ),
    // A heading's id is left out: two replies with one heading would share it.
    h1: ({ children }: Drawn) => <h3 className="text-sm font-semibold">{children}</h3>,
    h2: ({ children }: Drawn) => <h3 className="text-sm font-semibold">{children}</h3>,
    h3: ({ children }: Drawn) => <h4 className="font-semibold">{children}</h4>,
    h4: ({ children }: Drawn) => <h5 className="font-medium">{children}</h5>,
    h5: ({ children }: Drawn) => <h6 className="font-medium">{children}</h6>,
    h6: ({ children }: Drawn) => <h6 className="font-medium">{children}</h6>,
    ul: ({ children }: Drawn) => (
      <ul
        className={
          isTaskList(children) ? 'flex flex-col gap-1' : 'flex list-disc flex-col gap-1 ps-5'
        }
      >
        {children}
      </ul>
    ),
    ol: ({ children, start }: Drawn & { readonly start?: number }) => (
      <ol start={start} className="flex list-decimal flex-col gap-1 ps-5">
        {children}
      </ol>
    ),
    input: TaskBox,
    blockquote: ({ children }: Drawn) => (
      <blockquote className="flex flex-col gap-2 border-s-2 border-border ps-3 text-muted-foreground">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="border-border-subtle" />,
    pre: CodeBlock,
    code: ({ children }: Drawn) => (
      <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
    table: ({ children }: Drawn) => (
      <div className="overflow-x-auto rounded-md border border-border-subtle">
        <table className="w-full border-collapse text-xs">{children}</table>
      </div>
    ),
    thead: ({ children }: Drawn) => <thead className="bg-muted/50">{children}</thead>,
    tr: ({ children }: Drawn) => (
      <tr className="border-b border-border-subtle last:border-b-0">{children}</tr>
    ),
    th: ({ children, style }: Drawn & { readonly style?: CSSProperties }) => (
      <th style={style} className="px-2 py-1.5 text-start font-medium">
        {children}
      </th>
    ),
    td: ({ children, style }: Drawn & { readonly style?: CSSProperties }) => (
      <td style={style} className="px-2 py-1.5 align-top">
        {children}
      </td>
    ),
    img: ({ alt, src }: { readonly alt?: string; readonly src?: string | null }) => {
      const host = linkTarget(src, window.location.href)
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
 * The reply's Markdown, drawn with the chat's components. Raw HTML stays text, and a reply that
 * starts with `---` is a rule, not front matter. A link's address is checked twice: the parser
 * drops `javascript:`, `vbscript:` and `data:` ones, and `Link` goes nowhere but the web, mail and
 * this application.
 */
export function Markdown({
  go,
  children,
}: {
  readonly go: Go
  readonly children: string
}): ReactNode {
  const options = useMemo(
    (): MarkdownToJSX.Options => ({
      overrides: overrides(go),
      disableParsingRawHTML: true,
      disableFrontmatter: true,
      // A reply of one line is still a paragraph, and the blocks go straight into the column.
      forceBlock: true,
      wrapper: Fragment,
    }),
    [go],
  )
  return (
    <div data-slot="chat-markdown" className="flex min-w-0 flex-col gap-2 break-words">
      <MarkdownToJsx options={options}>{children}</MarkdownToJsx>
    </div>
  )
}
