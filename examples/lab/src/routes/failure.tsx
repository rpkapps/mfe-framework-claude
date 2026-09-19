import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@tecton/react/components/button'
import { useState, type ReactNode } from 'react'

import { LabPage, LabSection } from '../lab-page.tsx'

export const Route = createFileRoute('/failure')({
  staticData: { breadcrumb: 'Failure' },
  component: Failure,
})

function Failure(): ReactNode {
  const [throwOnRender, setThrowOnRender] = useState(false)

  return (
    <LabPage
      eyebrow="Failure"
      title="What breaks when this App breaks"
      description="An MFE that throws costs the page its own region and nothing else. The shell chrome stays, every other application stays reachable, and the failure names the definition that produced it."
      tryThis={
        <>
          Throw from this route. The shell header and the application finder above keep working, and
          the boundary&apos;s retry is a genuinely fresh attempt rather than a re-render of the same
          broken tree.
        </>
      }
    >
      <LabSection title="Throw during render" note="contained by the boundary">
        <p className="text-sm text-muted-foreground">
          This is the failure a host has to survive well, so it is worth being able to cause on
          purpose.
        </p>
        <div>
          <Button
            variant="outline"
            onPress={() => {
              setThrowOnRender(true)
            }}
          >
            Throw from this route
          </Button>
        </div>
        {throwOnRender ? <Exploder /> : null}
      </LabSection>
    </LabPage>
  )
}

function Exploder(): ReactNode {
  throw new Error('The lab threw on purpose, from inside a mounted App.')
}
