/** Every export here is a component, so React Refresh replaces this module in place instead of
 * reloading the page (§18). */

import type { WidgetRenderProps } from '@company/mfe-react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@tecton/react/components/alert'
import { Button } from '@tecton/react/components/button'
import { ButtonGroup } from '@tecton/react/components/button-group'
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
      <AlertAction>
        <ButtonGroup>
          <Button
            size="sm"
            isDisabled={state === 'acknowledged'}
            onPress={() => {
              setState('acknowledged')
              emit('acknowledged', {
                alertId: inputs.alertId,
                acknowledgedAt: new Date().toISOString(),
              })
            }}
          >
            <CheckIcon /> Acknowledge
          </Button>
          <Button
            variant="outline"
            size="sm"
            onPress={() => {
              setState('dismissed')
              emit('dismissed', { alertId: inputs.alertId })
            }}
          >
            <XIcon /> Dismiss
          </Button>
        </ButtonGroup>
      </AlertAction>
    </Alert>
  )
}
