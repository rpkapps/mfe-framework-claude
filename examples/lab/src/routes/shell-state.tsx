import { createFileRoute } from '@tanstack/react-router'
import { useGroups, useTheme, useUser } from '@company/mfe-react'
import { Avatar, AvatarFallback } from '@tecton/react/components/avatar'
import { Badge } from '@tecton/react/components/badge'
import { MoonIcon, SunIcon } from 'lucide-react'
import type { ReactNode } from 'react'

import { DataList, DataRow, Identifier, LabPage, LabSection, Tags } from '../lab-page.tsx'

export const Route = createFileRoute('/shell-state')({
  staticData: { breadcrumb: 'Shell state' },
  component: ShellState,
})

function ShellState(): ReactNode {
  const user = useUser()
  const groups = useGroups()
  const theme = useTheme()

  const initials = (user?.name ?? '?')
    .split(/\s+/)
    .map(part => part[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <LabPage
      eyebrow="Shell state"
      title="Identity, groups and theme come from the shell"
      description="One page, one session, one theme. An MFE subscribes to them; it never owns them, and never stores a second copy that can drift."
      tryThis={
        <>
          Switch the theme from the shell&apos;s user menu, top right, or press{' '}
          <code className="font-mono">⌘J</code>. The value below changes in this application without
          a reload and without a prop being passed across the boundary.
        </>
      }
    >
      <LabSection title="Who is signed in" note="useUser">
        {user === null ? (
          <p className="text-sm text-muted-foreground">
            Nobody. <code className="font-mono">useUser()</code> is null until the shell publishes a
            session, which is the state an MFE has to render rather than assume away.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Avatar size="lg">
                <AvatarFallback>{initials}</AvatarFallback>
              </Avatar>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium">{user.name}</span>
                <span className="truncate text-sm text-muted-foreground">{user.email}</span>
              </div>
            </div>
            <DataList>
              <DataRow label="id" hint="stable across sessions">
                <Identifier value={user.id} copy />
              </DataRow>
              <DataRow label="name">{user.name}</DataRow>
              <DataRow label="email">
                <Identifier value={user.email ?? '—'} />
              </DataRow>
            </DataList>
          </>
        )}
      </LabSection>

      <LabSection title="What they are a member of" note="useGroups">
        <p className="text-sm text-muted-foreground">
          Group membership, not permission. An MFE decides what a group may do; the shell only says
          which groups there are — and an identity or group change retires this mount&apos;s stored
          session state before any new value can be read back.
        </p>
        <Tags values={groups} variant="info" empty="No groups on this session." />
      </LabSection>

      <LabSection title="Which theme is active" note="useTheme">
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={theme === 'dark' ? 'secondary' : 'warning'} size="lg">
            {theme === 'dark' ? <MoonIcon aria-hidden /> : <SunIcon aria-hidden />}
            {theme} theme
          </Badge>
          <p className="min-w-0 text-sm text-muted-foreground">
            The shell owns the document class this keys off, and remembers the choice. Nothing in
            this application writes it.
          </p>
        </div>
      </LabSection>
    </LabPage>
  )
}
