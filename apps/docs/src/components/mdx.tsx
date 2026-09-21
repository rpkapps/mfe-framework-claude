import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { Kbd } from '@tecton/react/components/kbd'
import { cn } from 'cn'

import { CopyButton } from './copy-button.tsx'
import { Diagram, Term } from './diagram.tsx'
import { Callout, Details, DocsTab, DocsTabs, Step, Steps } from './docs-blocks.tsx'
import { getIconForLanguageExtension } from './language-icon.tsx'

import type { MDXComponents } from 'mdx/types'

function getNodeText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return getNodeText(node.props.children)
  }
  // Arrays and fragments: `Children.toArray` flattens both and drops the empty nodes.
  if (typeof node === 'object' && node !== null && Symbol.iterator in node) {
    return React.Children.toArray(node)
      .map(child => getNodeText(child))
      .join('')
  }
  return ''
}

function HeadingAnchor({ id, children }: { id: string | undefined; children: React.ReactNode }) {
  if (id === undefined) return children
  return (
    <a className="group no-underline" href={`#${id}`}>
      <span className="underline-offset-4 group-hover:underline">{children}</span>
      <span
        aria-hidden="true"
        className="ml-2 text-muted-foreground opacity-0 group-hover:opacity-100"
      >
        #
      </span>
    </a>
  )
}

function heading(Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') {
  return function Heading({ children, id, ...props }: React.ComponentProps<typeof Tag>) {
    return (
      <Tag id={id} {...props}>
        <HeadingAnchor id={id}>{children}</HeadingAnchor>
      </Tag>
    )
  }
}

/** An internal link navigates through the router; an external one opens in a new tab. */
function DocsLink({ href = '', className, children, ...props }: React.ComponentProps<'a'>) {
  if (href.startsWith('/') && !href.startsWith('//')) {
    return (
      <Link to={href} className={className}>
        {children}
      </Link>
    )
  }
  const external = href.startsWith('http')
  return (
    <a
      href={href}
      className={className}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer' : undefined}
      {...props}
    >
      {children}
    </a>
  )
}

/** The fence's language, from the `language-*` class `rehype-code` puts on the `<code>` child. */
function fenceLanguage(children: React.ReactNode): string | null {
  let language: string | null = null
  React.Children.forEach(children, child => {
    if (!React.isValidElement<{ className?: string }>(child)) return
    const match = /(?:^|\s)language-([\w+#.-]+)/.exec(child.props.className ?? '')
    if (match?.[1] !== undefined) language = match[1]
  })
  return language
}

/**
 * A code fence. `rehype-code` hands back a `<pre>` carrying the shiki classes and the fence's
 * `title=` meta; the title bar, the copy button and the surface around it are this site's.
 */
function Pre({
  className,
  children,
  title,
  ...props
}: Omit<React.ComponentProps<'pre'>, 'title'> & { title?: string; icon?: string }) {
  // `icon` is a raw SVG string from rehype-code; the language picks a real component instead.
  const { icon: _icon, ...rest } = props
  const language = fenceLanguage(children)

  return (
    <figure data-rehype-pretty-code-figure="" data-not-typeset>
      {title !== undefined && (
        <figcaption
          data-rehype-pretty-code-title=""
          className="flex items-center gap-2 text-code-foreground [&_svg]:size-4 [&_svg]:text-code-foreground [&_svg]:opacity-70"
        >
          {language !== null && getIconForLanguageExtension(language)}
          <span className="truncate">{title}</span>
        </figcaption>
      )}
      <CopyButton value={getNodeText(children)} />
      <pre
        data-language={language ?? undefined}
        className={cn(
          'no-scrollbar min-w-0 overflow-x-auto overflow-y-auto overscroll-x-contain overscroll-y-auto px-4 py-3.5 outline-none',
          className,
        )}
        {...rest}
      >
        {children}
      </pre>
    </figure>
  )
}

/**
 * A Markdown image. One under `/diagrams/` gets the frame and the dark-mode inversion the
 * `Diagram` component gives its figure, because `docs/design.md` has to write its diagrams as
 * plain Markdown to render on GitHub. Spans rather than divs: remark puts a lone image inside a
 * paragraph, and a div there is invalid HTML.
 */
function DocsImage({ className, alt, src, ...props }: React.ComponentProps<'img'>) {
  const image = (
    <img className={cn('rounded-2xl border', className)} alt={alt ?? ''} src={src} {...props} />
  )
  if (typeof src !== 'string' || !src.startsWith('/diagrams/')) return image

  return (
    <span data-slot="diagram" className="block">
      <span data-slot="diagram-frame" className="block">
        <img className={className} alt={alt ?? ''} src={src} {...props} />
      </span>
    </span>
  )
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    h1: heading('h1'),
    h2: heading('h2'),
    h3: heading('h3'),
    h4: heading('h4'),
    h5: heading('h5'),
    h6: heading('h6'),
    a: DocsLink,
    pre: Pre,
    // Typeset tables stay real tables; wide ones scroll horizontally.
    table: (props: React.ComponentProps<'table'>) => (
      <div className="typeset-scroll no-scrollbar scroll-fade-x *:[table]:w-full">
        <table {...props} />
      </div>
    ),
    img: DocsImage,
    Callout,
    Details,
    Diagram,
    Kbd,
    Link: DocsLink,
    Step,
    Steps,
    Tab: DocsTab,
    Tabs: DocsTabs,
    Term,
    ...components,
  }
}

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}
