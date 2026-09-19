/**
 * The frame every lab page shares: what the page demonstrates, what to try, and
 * a readout of what actually happened.
 *
 * Shared so each page is only the feature it is about. Components only, so an
 * edit to a lab page hot-updates instead of reloading the shell around it.
 */

import { Badge } from '@tecton/react/components/badge'
import { Separator } from '@tecton/react/components/separator'
import {
  PageHeader,
  PageHeaderContent,
  PageHeaderDescription,
  PageHeaderEyebrow,
  PageHeaderTitle,
} from '@tecton/react/tecton/page-header'
import { Panel, PanelContent, PanelHeader, PanelTitle } from '@tecton/react/tecton/panel'
import { MousePointerClickIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function LabPage({
  eyebrow,
  title,
  description,
  tryThis,
  children,
}: {
  readonly eyebrow: string
  readonly title: string
  readonly description: ReactNode
  readonly tryThis: ReactNode
  readonly children: ReactNode
}): ReactNode {
  return (
    <div className="flex flex-col gap-6 px-4 py-6 md:px-6">
      <PageHeader>
        <PageHeaderContent>
          <PageHeaderEyebrow>{eyebrow}</PageHeaderEyebrow>
          <PageHeaderTitle>{title}</PageHeaderTitle>
          <PageHeaderDescription>{description}</PageHeaderDescription>
        </PageHeaderContent>
      </PageHeader>

      <p className="flex items-start gap-2 rounded-lg border border-border-subtle bg-card p-3 text-sm">
        <MousePointerClickIcon
          aria-hidden
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <span>
          <span className="font-medium">Try this. </span>
          {tryThis}
        </span>
      </p>

      {children}
    </div>
  )
}

/** A titled area for one experiment on a lab page. */
export function LabSection({
  title,
  note,
  children,
}: {
  readonly title: string
  readonly note?: string
  readonly children: ReactNode
}): ReactNode {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>{title}</PanelTitle>
        {note === undefined ? null : <Badge variant="secondary">{note}</Badge>}
      </PanelHeader>
      <PanelContent className="flex flex-col gap-3">{children}</PanelContent>
    </Panel>
  )
}

/** What actually happened, verbatim. The point of every page here. */
export function Readout({
  label,
  value,
}: {
  readonly label: string
  readonly value: unknown
}): ReactNode {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

export function LabDivider(): ReactNode {
  return <Separator emphasis="subtle" />
}
