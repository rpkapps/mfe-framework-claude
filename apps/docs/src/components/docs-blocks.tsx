'use client'

import * as React from 'react'
import { Alert, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@tecton/react/components/tabs'
import { cn } from 'cn'
import { AlertTriangleIcon, InfoIcon, OctagonAlertIcon } from 'lucide-react'

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
