'use client'

import * as React from 'react'
import { Button } from '@tecton/react/components/button'
import { Collapsible, CollapsibleContent } from '@tecton/react/components/collapsible'
import { cn } from 'cn'
import { ChevronDownIcon } from 'lucide-react'

/**
 * A rendered Excalidraw diagram with the text equivalent beside it.
 *
 * The SVG is committed under `docs/diagrams/` so `docs/design.md` renders on GitHub, and the site
 * serves that directory at `/diagrams/`. It is exported with light colours on a transparent
 * background; the dark theme inverts it in CSS (`[data-slot="diagram-frame"] img` in app.css),
 * the way Excalidraw's own dark export does.
 *
 * `children` is the text equivalent: Markdown, mandatory, and complete enough that a reader with
 * images off learns the same thing. It renders as prose inside a disclosure.
 */
export function Diagram({
  src,
  alt,
  caption,
  children,
  className,
}: {
  src: string
  alt: string
  caption?: string
  children: React.ReactNode
  className?: string
}) {
  const [isOpen, setIsOpen] = React.useState(false)

  return (
    <div data-slot="diagram" className={cn(className)}>
      <figure className="m-0">
        <div data-slot="diagram-frame">
          <img src={src} alt={alt} loading="lazy" decoding="async" />
        </div>
        {caption !== undefined && (
          <figcaption className="mt-3 text-center text-sm text-muted-foreground">
            {caption}
          </figcaption>
        )}
      </figure>
      <Collapsible isExpanded={isOpen} onExpandedChange={setIsOpen} className="mt-3">
        <Button
          slot="trigger"
          variant="ghost"
          size="sm"
          className="not-typeset -ml-2 text-muted-foreground hover:text-foreground"
        >
          <ChevronDownIcon
            data-icon="inline-start"
            className={cn('transition-transform', isOpen && 'rotate-180')}
          />
          Read this diagram as text
        </Button>
        <CollapsibleContent>
          <div className="typeset rounded-xl border border-border-subtle px-4 py-3 text-sm">
            {children}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

/** First use of a term on a page: `<Term>micro-frontend</Term>`. */
export function Term({ className, ...props }: React.ComponentProps<'dfn'>) {
  return (
    <dfn
      className={cn(
        'font-medium text-foreground not-italic underline decoration-border-strong decoration-dotted underline-offset-4',
        className,
      )}
      {...props}
    />
  )
}
