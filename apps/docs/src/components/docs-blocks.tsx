'use client'

import * as React from 'react'
import { Link } from '@tanstack/react-router'
import { Alert, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
import { Button } from '@tecton/react/components/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@tecton/react/components/card'
import { Collapsible, CollapsibleContent } from '@tecton/react/components/collapsible'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@tecton/react/components/tabs'
import { cn } from 'cn'
import { AlertTriangleIcon, ChevronDownIcon, InfoIcon, OctagonAlertIcon } from 'lucide-react'

/* ------------------------------------------------------------------------ */
/* Callout                                                                   */
/* ------------------------------------------------------------------------ */

type CalloutType = 'info' | 'warning' | 'error'

const CALLOUT_ICON: Record<CalloutType, React.ReactNode> = {
  info: <InfoIcon />,
  warning: <AlertTriangleIcon />,
  error: <OctagonAlertIcon />,
}

const CALLOUT_VARIANT = {
  info: 'info',
  warning: 'warning',
  error: 'destructive',
} as const

export function Callout({
  type = 'info',
  title,
  children,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Alert>, 'variant' | 'title'> & {
  type?: CalloutType
  title?: React.ReactNode
}) {
  return (
    <Alert
      data-not-typeset
      variant={CALLOUT_VARIANT[type]}
      appearance="outline"
      className={cn('mt-6 w-auto rounded-2xl md:-mx-1 **:[code]:border', className)}
      {...props}
    >
      {CALLOUT_ICON[type]}
      {title !== undefined && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription className="[&_p]:my-0 [&_ul]:my-2 [&_ul]:list-disc">
        {children}
      </AlertDescription>
    </Alert>
  )
}

/* ------------------------------------------------------------------------ */
/* Details — progressive disclosure. Closed by default.                     */
/* ------------------------------------------------------------------------ */

export function Details({
  summary,
  defaultOpen = false,
  children,
  className,
}: {
  /** The trigger's label. Stays visible, open or closed. */
  summary: React.ReactNode
  /** Open on first render. Defaults to closed. */
  defaultOpen?: boolean
  /** The body, as Markdown. Renders as prose once open. */
  children: React.ReactNode
  className?: string
}) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen)

  return (
    <Collapsible
      data-slot="details"
      isExpanded={isOpen}
      onExpandedChange={setIsOpen}
      className={cn('mt-6 overflow-hidden rounded-xl border border-border-subtle', className)}
    >
      <Button
        slot="trigger"
        variant="ghost"
        className="not-typeset h-auto w-full justify-between gap-3 px-4 py-3 text-left font-medium"
      >
        {summary}
        <ChevronDownIcon
          data-icon="inline-end"
          className={cn(
            'shrink-0 text-muted-foreground transition-transform',
            isOpen && 'rotate-180',
          )}
        />
      </Button>
      <CollapsibleContent>
        <div className="typeset border-t border-border-subtle px-4 py-3 text-sm">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/* ------------------------------------------------------------------------ */
/* Steps                                                                     */
/* ------------------------------------------------------------------------ */

export function Steps({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn('steps mb-12 [counter-reset:step] md:ml-4 md:border-l md:pl-8', className)}
      {...props}
    />
  )
}

export function Step({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="step" className={cn('step relative mt-8', className)} {...props} />
}

/* ------------------------------------------------------------------------ */
/* Tabs — `<Tabs items={[...]}>` with one `<Tab value>` per item.            */
/* ------------------------------------------------------------------------ */

function tabValues(children: React.ReactNode): string[] {
  const values: string[] = []
  React.Children.forEach(children, child => {
    if (!React.isValidElement<{ value?: string }>(child)) return
    const { value } = child.props
    if (typeof value === 'string') values.push(value)
  })
  return values
}

export function DocsTabs({
  items,
  children,
  defaultValue,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Tabs>, 'children'> & {
  items?: string[]
  children: React.ReactNode
  defaultValue?: string
}) {
  const values = items ?? tabValues(children)
  const initial = defaultValue ?? values[0]

  return (
    <Tabs
      data-not-typeset
      {...(initial === undefined ? {} : { defaultSelectedKey: initial })}
      className={cn('relative mt-6 w-full gap-4', className)}
      {...props}
    >
      <TabsList
        variant="line"
        className="h-auto justify-start gap-6 rounded-none bg-transparent p-0"
      >
        {values.map(value => (
          <TabsTrigger
            key={value}
            id={value}
            className="h-auto px-0 pb-3 text-base font-medium text-muted-foreground hover:text-foreground data-selected:text-foreground"
          >
            {value}
          </TabsTrigger>
        ))}
      </TabsList>
      {children}
    </Tabs>
  )
}

export function DocsTab({
  value,
  className,
  ...props
}: Omit<React.ComponentProps<typeof TabsContent>, 'id'> & { value: string }) {
  return (
    <TabsContent
      id={value}
      className={cn(
        'relative *:[figure]:first:mt-0 [&>.steps]:mt-6 [&>[data-rehype-pretty-code-figure]:first-child]:mt-0',
        className,
      )}
      {...props}
    />
  )
}

/* ------------------------------------------------------------------------ */
/* Cards — `<Cards>` with one `<Card href title>` per destination.          */
/* ------------------------------------------------------------------------ */

export function DocsCards({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-not-typeset
      data-slot="cards"
      className={cn('mt-6 grid gap-3 sm:grid-cols-2', className)}
      {...props}
    />
  )
}

/**
 * One destination: a title, and at most a line saying what is there. The whole card is the link,
 * so the body is text rather than Markdown — a link inside a link is invalid HTML.
 */
export function DocsCard({
  href,
  title,
  children,
  className,
}: {
  /** A site path (`/docs/add-a-route`) navigates through the router. */
  href: string
  title: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  const inner = (
    <Card
      size="sm"
      className={cn(
        'h-full gap-2 bg-card transition-colors group-hover/card-link:bg-accent group-hover/card-link:ring-accent',
        className,
      )}
    >
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {children !== undefined && <CardDescription>{children}</CardDescription>}
      </CardHeader>
    </Card>
  )

  const linkClassName =
    'group/card-link block h-full rounded-xl no-underline outline-none focus-visible:ring-2 focus-visible:ring-ring/60'

  if (href.startsWith('/') && !href.startsWith('//')) {
    return (
      <Link to={href} className={linkClassName}>
        {inner}
      </Link>
    )
  }
  return (
    <a href={href} className={linkClassName} target="_blank" rel="noreferrer">
      {inner}
    </a>
  )
}
