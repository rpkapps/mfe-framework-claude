/** Every export here is a component, so React Refresh replaces this module in place instead of
 * reloading the page (§18). */

import { allow, deny, useAction, type WidgetRenderProps } from '@company/mfe-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
import { Button } from '@tecton/react/components/button'
import { CheckIcon, InfoIcon, OctagonAlertIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'

import type { alertPanelContract } from './mfe.ts'

const SEVERITY = {
  info: { label: 'Informational', variant: 'info', Icon: InfoIcon },
  warning: { label: 'Needs attention', variant: 'warning', Icon: TriangleAlertIcon },
  critical: { label: 'Critical', variant: 'destructive', Icon: OctagonAlertIcon },
} as const

export function AlertPanel({
  inputs,
  emit,
}: WidgetRenderProps<typeof alertPanelContract>): ReactNode {
  const [state, setState] = useState<'open' | 'acknowledged' | 'dismissed'>('open')
  const { label, variant, Icon } = SEVERITY[inputs.severity]

  // In the palette while this Widget is mounted, and the button below runs the same action. A page
  // that shows two alerts registers the name twice; the runtime gives the second its own id
  // (`alert-panel:acknowledge-2`), and the label says which alert each entry is for.
  const acknowledge = useAction({
    name: 'acknowledge',
    label: `Acknowledge alert ${inputs.alertId}`,
    description: 'Marks this alert as seen by the user, and tells the App that placed it.',
    canExecute: () =>
      state === 'open' ? allow() : deny(`Alert ${inputs.alertId} is no longer open.`),
    execute: () => {
      setState('acknowledged')
      emit('acknowledged', { alertId: inputs.alertId, acknowledgedAt: new Date().toISOString() })
    },
  })

  if (state === 'dismissed') {
    return (
      <Alert appearance="outline">
        <CheckIcon />
        <AlertTitle>Alert {inputs.alertId} dismissed</AlertTitle>
      </Alert>
    )
  }

  return (
    <Alert variant={variant} appearance="outline">
      <Icon />
      <AlertTitle>Alert {inputs.alertId}</AlertTitle>
      <AlertDescription>
        {label}
        {state === 'acknowledged' ? ' · acknowledged by you' : ''}
      </AlertDescription>
      {/* Two decisions about the alert, not one control: a ButtonGroup joined them into a shape
          that read as a segmented selector. Both are ghost, which is what `AlertAction` tints to
          the alert's own severity — a solid primary was a second palette inside a coloured
          surface. The label against the icon is what separates the two, not the weight. */}
      <AlertAction>
        <Button
          variant="ghost"
          size="sm"
          isDisabled={state === 'acknowledged'}
          onPress={() => {
            void acknowledge()
          }}
        >
          <CheckIcon data-icon="inline-start" />
          {state === 'acknowledged' ? 'Acknowledged' : 'Acknowledge'}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Dismiss alert ${inputs.alertId}`}
          onPress={() => {
            setState('dismissed')
            emit('dismissed', { alertId: inputs.alertId })
          }}
        >
          <XIcon />
        </Button>
      </AlertAction>
    </Alert>
  )
}
