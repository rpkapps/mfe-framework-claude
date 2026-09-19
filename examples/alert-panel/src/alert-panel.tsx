/**
 * What the Widget renders.
 *
 * Its own module, and every export a component, so React Refresh can replace it
 * in place. The entry beside it cannot be: `src/mfe.ts` exports the definition
 * and its contract by contract, neither of which is a component, so an edit
 * there propagates to the generated entry and reloads the page. Keeping the
 * render here is what makes editing a Widget feel like editing a component.
 */

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
