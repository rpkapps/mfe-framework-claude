import { createFileRoute } from '@tanstack/react-router'
import { useBreadcrumbs } from '@company/mfe-react'
import { Button } from '@tecton/react/components/button'
import { useState, type ReactNode } from 'react'

import { LabPage, LabSection } from '../lab-page.tsx'

export const Route = createFileRoute('/breadcrumbs')({
  staticData: { breadcrumb: 'Breadcrumbs' },
  component: Breadcrumbs,
})

const FLOW = [
  { key: 'wizard', label: 'New study' },
  { key: 'step-2', label: 'Step 2 · Inputs' },
]

function Breadcrumbs(): ReactNode {
  const [override, setOverride] = useState(false)

  // The one non-route override, for flows a route tree cannot express. It
  // replaces only this App's own portion of the trail, and clears on unmount
  // and on navigation — so a wizard cannot leak its steps into the next route.
  useBreadcrumbs(override ? FLOW : [])

  return (
    <LabPage
      eyebrow="Breadcrumbs"
      title="The shell's trail, composed with this App's"
      description="The shell contributes the workspace and the mounted App at depth 0. This App contributes everything below it, from its own route tree. Neither writes the other's part, and the store composes them."
      tryThis={
        <>
          Look at the trail in the shell header: it already shows this route&apos;s name, which came
          from <code className="font-mono">staticData.breadcrumb</code> on the route. Now override
          it below, then navigate away — the override clears itself.
        </>
      }
    >
      <LabSection title="An override for a flow" note="useBreadcrumbs">
        <p className="text-sm text-muted-foreground">
          A wizard has steps a route tree does not name. The override replaces this App&apos;s
          portion only; the workspace crumb the shell owns stays exactly where it was.
        </p>
        <div>
          <Button
            variant={override ? 'default' : 'outline'}
            onPress={() => {
              setOverride(current => !current)
            }}
          >
            {override ? 'Clear the override' : 'Override the trail'}
          </Button>
        </div>
      </LabSection>
    </LabPage>
  )
}
