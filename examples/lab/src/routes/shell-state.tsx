import { createFileRoute } from '@tanstack/react-router'
import { useGroups, useTheme, useUser } from '@company/mfe-react'
import type { ReactNode } from 'react'

import { LabPage, LabSection, Readout } from '../lab-page.tsx'

export const Route = createFileRoute('/shell-state')({
  staticData: { breadcrumb: 'Shell state' },
  component: ShellState,
})

function ShellState(): ReactNode {
  const user = useUser()
  const groups = useGroups()
  const theme = useTheme()

  return (
    <LabPage
      eyebrow="Shell state"
      title="Identity, groups and theme come from the shell"
      description="One page, one session, one theme. An MFE subscribes to them; it never owns them, and never stores a second copy that can drift."
      tryThis={
        <>
          Switch the theme from the shell&apos;s user menu, top right. The value below changes in
          this application without a reload and without a prop being passed across the boundary.
        </>
      }
    >
      <LabSection title="Who is signed in" note="useUser">
        <Readout label="user" value={user} />
      </LabSection>

      <LabSection title="What they are a member of" note="useGroups">
        <p className="text-sm text-muted-foreground">
          Group membership, not permission. An MFE decides what a group may do; the shell only says
          which groups there are — and an identity or group change retires this mount&apos;s stored
          session state before any new value can be read back.
        </p>
        <Readout label="groups" value={groups} />
      </LabSection>

      <LabSection title="Which theme is active" note="useTheme">
        <Readout label="theme" value={theme} />
      </LabSection>
    </LabPage>
  )
}
